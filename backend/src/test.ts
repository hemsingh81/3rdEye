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

async function createChild(token: string, name: string): Promise<string> {
  const child = await authedFetch(token, "/api/children", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => r.json());
  assert(child.id, `child profile created (${name})`);
  return child.id;
}

async function main() {
  const { familyId, token } = await registerAndLogin("Test Family", `test-${Date.now()}@example.com`);
  const childId = await createChild(token, "Emma");

  // --- STORY-09: a device with no child_profile_id is rejected outright. ---
  const noChildRes = await authedFetch(token, "/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "android" }),
  });
  assert(noChildRes.status === 400, "enrolling a device with no child_profile_id is rejected");

  const device = await authedFetch(token, "/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "android", child_profile_id: childId }),
  }).then((r) => r.json());
  assert(device.enrollment_code, "device enrollment code issued");
  assert(device.enrollment_status === "pending", "device starts pending");
  assert(device.family_id === familyId, "device created under the authenticated user's own family, not a client-supplied one");
  assert(device.child_profile_id === childId, "device assigned to the requested child profile");

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

  // --- STORY-09 core acceptance: a second device under the SAME child
  // shares the policy that was just set on the first device. ---
  const secondDevice = await authedFetch(token, "/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "windows", child_profile_id: childId }),
  }).then((r) => r.json());
  const secondDevicePolicy = await fetch(`${base}/api/devices/${secondDevice.id}/policy`).then((r) => r.json());
  assert(secondDevicePolicy.version === 2, "a second device under the same child sees the same policy version");
  assert(secondDevicePolicy.daily_limit_minutes === 60, "a second device under the same child sees the same policy values, set from the first device");

  const policyFromSecondDevice = await authedFetch(token, `/api/devices/${secondDevice.id}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ daily_limit_minutes: 45, content_filter_categories: ["adult", "violence", "gambling"] }),
  }).then((r) => r.json());
  assert(policyFromSecondDevice.version === 3, "editing policy from the second device increments the SAME shared row, not a separate one");
  const firstDevicePolicyAfter = await fetch(`${base}/api/devices/${device.id}/policy`).then((r) => r.json());
  assert(firstDevicePolicyAfter.daily_limit_minutes === 45, "the first device sees the edit made from the second device — one shared policy, not two drifting ones");

  // --- STORY-09: a device with no child assigned can't have its policy set. ---
  const orphanDevice = await authedFetch(token, "/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "windows", child_profile_id: childId }),
  }).then((r) => r.json());
  await pool.query("UPDATE devices SET child_profile_id = NULL WHERE id = $1", [orphanDevice.id]);
  const orphanPolicyRes = await authedFetch(token, `/api/devices/${orphanDevice.id}/policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ daily_limit_minutes: 30, content_filter_categories: [] }),
  });
  assert(orphanPolicyRes.status === 404, "a device with no child profile assigned can't have its policy set (fails cleanly, not a crash)");

  // --- STORY-10: F3 app control backend (inventory + allowlist actions) ---
  const reportApps = () =>
    fetch(`${base}/api/devices/${device.id}/installed-apps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apps: [{ app_id: "com.example.among-us", install_source: "store" }, { app_id: "com.example.minecraft", install_source: "store" }] }),
    }).then((r) => r.json());

  const firstReport = await reportApps();
  assert(firstReport.reported === 2, "agent's installed-app inventory report accepted (device-channel, no auth required)");

  const inventoryBeforeApproval = await authedFetch(token, `/api/devices/${device.id}/installed-apps`).then((r) => r.json());
  assert(inventoryBeforeApproval.every((a: any) => a.is_approved === false), "a freshly-reported app is not approved by default (default-deny)");

  const approveRes = await authedFetch(token, `/api/devices/${device.id}/policy/apps`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: "com.example.among-us", approved: true }),
  }).then((r) => r.json());
  assert(approveRes.app_allowlist.some((a: any) => a.app_id === "com.example.among-us"), "approving an app adds it to the child's allowlist");

  const inventoryAfterApproval = await authedFetch(token, `/api/devices/${device.id}/installed-apps`).then((r) => r.json());
  assert(inventoryAfterApproval.find((a: any) => a.app_id === "com.example.among-us")?.is_approved === true, "the approved app now shows as approved in the inventory");
  assert(inventoryAfterApproval.find((a: any) => a.app_id === "com.example.minecraft")?.is_approved === false, "the OTHER app is unaffected — still not approved");

  // STORY-11 review catch: the main policy-pull endpoint never exposed
  // app_control_mode/app_allowlist at all — an agent could never actually
  // know what to enforce. Confirm the fix: the device-channel policy pull
  // (no auth) now reflects the just-approved app as a flat app_id array.
  const policyPullAfterApproval = await fetch(`${base}/api/devices/${device.id}/policy`).then((r) => r.json());
  assert(policyPullAfterApproval.app_control_mode === "default_deny", "policy pull exposes app_control_mode");
  assert(Array.isArray(policyPullAfterApproval.app_allowlist) && policyPullAfterApproval.app_allowlist.includes("com.example.among-us"), "policy pull exposes the approved app_id as a flat array the agent can match against");

  // Reuses STORY-09's shared-policy device — approving from one device's
  // dashboard view approves it for every device under the same child.
  const secondDeviceInventoryCheck = await authedFetch(token, `/api/devices/${secondDevice.id}/installed-apps`);
  assert(secondDeviceInventoryCheck.status === 200, "second device under the same child is a valid target for the inventory endpoint too");

  const approveAgainRes = await authedFetch(token, `/api/devices/${device.id}/policy/apps`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: "com.example.among-us", approved: true }),
  }).then((r) => r.json());
  assert(approveAgainRes.app_allowlist.filter((a: any) => a.app_id === "com.example.among-us").length === 1, "re-approving an already-approved app does not duplicate the allowlist entry");

  const blockRes = await authedFetch(token, `/api/devices/${device.id}/policy/apps`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: "com.example.among-us", approved: false }),
  }).then((r) => r.json());
  assert(!blockRes.app_allowlist.some((a: any) => a.app_id === "com.example.among-us"), "blocking an app removes it from the allowlist");

  const appsForbidden = await authedFetch(otherToken, `/api/devices/${device.id}/installed-apps`);
  assert(appsForbidden.status === 404, "a different family's token cannot read this device's installed-app inventory");

  const blockOrphan = await authedFetch(token, `/api/devices/${orphanDevice.id}/policy/apps`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: "com.example.anything", approved: false }),
  });
  assert(blockOrphan.status === 404, "a device with no child assigned can't have its app-allowlist edited either (same guard as the main policy PUT)");

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

  // STORY-09 created more than one device under this family now — find the
  // one under test by id rather than assuming it's still list index 0.
  const afterEvents = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(afterEvents.find((d: any) => d.id === device.id)?.last_synced_at !== null, "last_synced_at updated after event flush");

  // --- STORY-05: alerts feed read endpoint ---
  const alertsFeed = await authedFetch(token, `/api/devices/${device.id}/alerts`).then((r) => r.json());
  assert(alertsFeed.length === 1 && alertsFeed[0].type === "daily_limit_reached", "alerts feed returns the posted alert event");

  const alertsForbidden = await authedFetch(otherToken, `/api/devices/${device.id}/alerts`);
  assert(alertsForbidden.status === 404, "a different family's token cannot read this device's alerts");

  // --- STORY-03: stale-device sweep (X9, offline-sync-spec.md §5) ---
  await pool.query("UPDATE devices SET last_synced_at = now() - interval '25 hours' WHERE id = $1", [device.id]);

  const firstSweepCount = await runStaleDeviceSweep();
  assert(firstSweepCount === 1, "sweep flags exactly the one backdated device on first run");

  const flaggedList = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(flaggedList.find((d: any) => d.id === device.id)?.needs_attention === true, "device shows needs_attention after crossing the threshold");

  const secondSweepCount = await runStaleDeviceSweep();
  assert(secondSweepCount === 0, "sweep does not re-flag (and re-alert) a device already flagged — no spam");

  await postEvents(); // a real sync should clear the flag
  const resyncedList = await authedFetch(token, "/api/devices").then((r) => r.json());
  assert(resyncedList.find((d: any) => d.id === device.id)?.needs_attention === false, "needs_attention clears once the device actually syncs again");

  console.log("All Phase 0 + policy + event + stale-device + auth + child-profile checks passed.");
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
