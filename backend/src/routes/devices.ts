import { randomBytes } from "node:crypto";
import { Router } from "express";
import { pool } from "../db/pool.js";

export const devicesRouter = Router();

const PLATFORMS = ["android", "ios", "macos", "windows"];
const CONSENT_POLICY_VERSION = "family-v1";

function generateEnrollmentCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

// Parent generates an enrollment code for a new device — family-tier-spec.md §3.1.
devicesRouter.post("/", async (req, res) => {
  const { family_id, platform } = req.body ?? {};
  if (typeof family_id !== "string" || !PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: "family_id and a valid platform are required" });
  }
  const code = generateEnrollmentCode();
  const { rows } = await pool.query(
    `INSERT INTO devices (family_id, platform, enrollment_code)
     VALUES ($1, $2, $3)
     RETURNING id, family_id, platform, enrollment_code, enrollment_status, created_at`,
    [family_id, platform, code],
  );
  res.status(201).json(rows[0]);
});

// The device-side agent looks up what to show on the consent screen — family-tier-spec.md §3.2 step 2.
devicesRouter.get("/by-code/:code", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, family_id, platform, enrollment_status FROM devices WHERE enrollment_code = $1",
    [req.params.code],
  );
  if (rows.length === 0) return res.status(404).json({ error: "unknown enrollment code" });
  res.json({
    device: rows[0],
    consent: {
      policy_version: CONSENT_POLICY_VERSION,
      categories_visible_to_parent: ["screen time", "location", "app installs", "web category"],
      never_collected: ["message content", "call/SMS content", "microphone", "camera"],
    },
  });
});

// Child taps "I understand" — records ConsentRecord and marks the device enrolled,
// per family-tier-spec.md §3.2 step 3 / system-architecture-spec.md §3.
devicesRouter.post("/:id/consent", async (req, res) => {
  const { accepted_by } = req.body ?? {};
  if (typeof accepted_by !== "string" || accepted_by.trim() === "") {
    return res.status(400).json({ error: "accepted_by is required" });
  }
  const device = await pool.query("SELECT id FROM devices WHERE id = $1", [req.params.id]);
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found" });

  const { rows } = await pool.query(
    `INSERT INTO consent_records (device_id, policy_version, accepted_by)
     VALUES ($1, $2, $3)
     RETURNING id, device_id, policy_version, accepted_at, accepted_by`,
    [req.params.id, CONSENT_POLICY_VERSION, accepted_by.trim()],
  );
  await pool.query(
    "UPDATE devices SET enrollment_status = 'enrolled', last_synced_at = now() WHERE id = $1",
    [req.params.id],
  );
  res.status(201).json(rows[0]);
});

// Admin console dashboard — device list with last-synced, per offline-sync-spec.md §5.
devicesRouter.get("/", async (req, res) => {
  const { family_id } = req.query;
  const { rows } = await pool.query(
    `SELECT id, family_id, platform, enrollment_status, last_synced_at, created_at
     FROM devices
     WHERE $1::uuid IS NULL OR family_id = $1
     ORDER BY created_at DESC`,
    [family_id ?? null],
  );
  res.json(rows);
});
