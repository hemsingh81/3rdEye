// Self-check for the Phase 0 exit criterion: enroll a device, show + record
// consent, see it in the device list. Run against a live backend (`npm run dev`).
const base = process.env.BASE_URL ?? "http://localhost:8080";

async function main() {
  const family = await fetch(`${base}/api/families`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test Family" }),
  }).then((r) => r.json());
  assert(family.id, "family created");

  const device = await fetch(`${base}/api/devices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ family_id: family.id, platform: "android" }),
  }).then((r) => r.json());
  assert(device.enrollment_code, "device enrollment code issued");
  assert(device.enrollment_status === "pending", "device starts pending");

  const lookup = await fetch(`${base}/api/devices/by-code/${device.enrollment_code}`).then((r) => r.json());
  assert(lookup.consent.policy_version, "consent screen data returned for enrollment code");

  const consent = await fetch(`${base}/api/devices/${device.id}/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accepted_by: "test-child" }),
  }).then((r) => r.json());
  assert(consent.id, "consent recorded");

  const list = await fetch(`${base}/api/devices?family_id=${family.id}`).then((r) => r.json());
  assert(list.length === 1 && list[0].enrollment_status === "enrolled", "device shows as enrolled in dashboard list");

  console.log("All Phase 0 checks passed.");
}

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`ok: ${label}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
