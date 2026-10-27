// Self-check for the Phase 0/1 exit criteria: enroll a device, show + record
// consent, see it in the device list, set/sync a policy, flush events, run
// the stale-device sweep, and verify auth actually scopes everything to the
// logged-in family. Run against a live backend (`npm run dev`).
import { pool } from "./db/pool.js";
import { runStaleDeviceSweep } from "./staleDeviceSweep.js";
import { signToken } from "./auth/jwt.js";

const base = process.env.BASE_URL ?? "http://localhost:8080";

function authedFetch(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  });
}

async function registerAndLogin(name: string, email: string): Promise<{ familyId: string; token: string }> {
  const register = await fetch(`${base}/api/families`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: "correct-password-123" }),
  }).then((r) => r.json());
  assert(register.family?.id, `family created (${name})`);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-password-123" }),
  }).then((r) => r.json());
  assert(login.token, `login succeeds and returns a token (${name})`);

  return { familyId: register.family.id, token: login.token };
}

async function main() {
  const { familyId, token } = await registerAndLogin("Test Family", `test-${Date.now()}@example.com`);

  const device = await authedFetch(token, "/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "android" }),
  }).then((r) => r.json());
  assert(device.enrollment_code, "device enrollment code issued");
  assert(device.enrollment_status === "pending", "device starts pending");
  assert(device.family_id === familyId, "device created under the authenticated user's own family, not a client-supplied one");

  // Device-trust-boundary endpoints stay unauthenticated — system-architecture-spec.md §2.1.
  const lookup = await fetch(`${base}/api/devices/by-code/${device.enrollment_code}`).then((r) => r.json());
  assert(lookup.consent.policy_version, "consent screen data returned for enrollment code (no auth required)");

  const consent = await fetch(`${base}/api/devices/${device.id}/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accepted_by: "test-child" }),
  }).then((r) => r.json());
  assert(consent.id, "consent recorded (no auth required)");

  const list = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(list.length === 1 && list[0].enrollment_status === "enrolled", "device shows as enrolled in dashboard list");

  // --- STORY-04: the three negative-path cases named explicitly in
  // implementation-plan.md §1.4 / development-stories.md STORY-04. ---
  const noTokenRes = await fetch(`${base}/api/devices`);
  assert(noTokenRes.status === 401, "no token: rejected");

  const expiredToken = signToken({ sub: "x", family_id: familyId, role: "parent" }, "-1s");
  const expiredRes = await authedFetch(expiredToken, "/api/devices");
  assert(expiredRes.status === 401, "expired token: rejected");

  const { token: otherToken } = await registerAndLogin("Other Family", `other-${Date.now()}@example.com`);
  const otherFamilysView = await authedFetch(otherToken, "/api/devices").then((r) => r.json());
  assert(otherFamilysView.length === 0, "a valid token for a different family never sees this family's device");

  const policyNotFoundForOtherFamily = await authedFetch(otherToken, `/api/devices/${device.id}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ daily_limit_minutes: 1, content_filter_categories: [] }),
  });
  assert(policyNotFoundForOtherFamily.status === 404, "a different family's token cannot edit this device's policy (404, not leaked via 403)");

  // --- Policy (PUT requires auth + ownership; GET stays device-channel, unauthenticated) ---
  const noPolicyYet = await fetch(`${base}/api/devices/${device.id}/policy`);
  assert(noPolicyYet.status === 404, "no policy set yet returns 404");

  const setPolicy = await authedFetch(token, `/api/devices/${device.id}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      daily_limit_minutes: 90,
      bedtime_start: "21:00",
      bedtime_end: "07:00",
      content_filter_categories: ["adult", "violence", "gambling"],
    }),
  }).then((r) => r.json());
  assert(setPolicy.version === 1, "policy created at version 1");
  assert(setPolicy.daily_limit_minutes === 90, "daily limit saved correctly");

  const getPolicy = await fetch(`${base}/api/devices/${device.id}/policy`).then((r) => r.json());
  assert(getPolicy.daily_limit_minutes === 90, "agent can pull the saved policy back (no auth required)");

  const updatedPolicy = await authedFetch(token, `/api/devices/${device.id}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      daily_limit_minutes: 60,
      content_filter_categories: ["adult", "violence", "gambling"],
    }),
  }).then((r) => r.json());
  assert(updatedPolicy.version === 2, "policy version increments on edit");
  assert(updatedPolicy.daily_limit_minutes === 60, "edited daily limit saved correctly");

  // --- STORY-01: event queue + sync protocol (device-channel, unauthenticated) ---
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const alertEventId = `test-alert-${Date.now()}`;
  const postEvents = () =>
    fetch(`${base}/api/devices/${device.id}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        usage_events: [{ client_event_id: `test-usage-${Date.now()}`, start_ts: fiveMinAgo.toISOString(), end_ts: now.toISOString() }],
        alert_events: [{ client_event_id: alertEventId, type: "daily_limit_reached", message: "Daily screen time limit reached (90 min).", ts: now.toISOString() }],
      }),
    }).then((r) => r.json());

  const firstPost = await postEvents();
  assert(firstPost.usage_events_inserted === 1, "usage event inserted on first post");
  assert(firstPost.alert_events_inserted === 1, "alert event inserted on first post");

  const retryPost = await postEvents();
  assert(retryPost.alert_events_inserted === 0, "retried post with same client_event_id does not double-insert (idempotency)");

  const afterEvents = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(afterEvents[0].last_synced_at !== null, "last_synced_at updated after event flush");

  // --- STORY-03: stale-device sweep (X9, offline-sync-spec.md §5) ---
  await pool.query("UPDATE devices SET last_synced_at = now() - interval '25 hours' WHERE id = $1", [device.id]);

  const firstSweepCount = await runStaleDeviceSweep();
  assert(firstSweepCount === 1, "sweep flags exactly the one backdated device on first run");

  const flaggedList = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(flaggedList[0].needs_attention === true, "device shows needs_attention after crossing the threshold");

  const secondSweepCount = await runStaleDeviceSweep();
  assert(secondSweepCount === 0, "sweep does not re-flag (and re-alert) a device already flagged — no spam");

  await postEvents(); // a real sync should clear the flag
  const resyncedList = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(resyncedList[0].needs_attention === false, "needs_attention clears once the device actually syncs again");

  console.log("All Phase 0 + policy + event + stale-device + auth checks passed.");
  await pool.end();
}

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`ok: ${label}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
