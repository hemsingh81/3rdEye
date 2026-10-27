import { randomBytes } from "node:crypto";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const devicesRouter = Router();

const PLATFORMS = ["android", "ios", "macos", "windows"];
const CONSENT_POLICY_VERSION = "family-v1";

function generateEnrollmentCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

// Parent generates an enrollment code for a new device — family-tier-spec.md
// §3.1. STORY-04: requires auth; the device is created under the
// *authenticated* family_id, never a client-supplied one. STORY-09: a
// device is now enrolled *for* a child, not just for a family — a child
// with a phone and a laptop assigns both devices to the same
// child_profile_id, so they end up sharing one Policy (policy.ts resolves
// through this column, not device_id directly).
devicesRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { platform, child_profile_id } = req.body ?? {};
  if (!PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: "a valid platform is required" });
  }
  if (typeof child_profile_id !== "string") {
    return res.status(400).json({ error: "child_profile_id is required" });
  }
  // Ownership check on the child profile, same 404-not-403 pattern as the
  // policy route — a child_profile_id alone doesn't prove it's this
  // family's own.
  const child = await pool.query("SELECT id FROM child_profiles WHERE id = $1 AND family_id = $2", [child_profile_id, req.auth!.family_id]);
  if (child.rows.length === 0) return res.status(404).json({ error: "child profile not found" });

  const code = generateEnrollmentCode();
  const { rows } = await pool.query(
    `INSERT INTO devices (family_id, child_profile_id, platform, enrollment_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, family_id, child_profile_id, platform, enrollment_code, enrollment_status, created_at`,
    [req.auth!.family_id, child_profile_id, platform, code],
  );
  res.status(201).json(rows[0]);
}));

// The device-side agent looks up what to show on the consent screen — family-tier-spec.md §3.2 step 2.
devicesRouter.get("/by-code/:code", asyncHandler(async (req, res) => {
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
}));

// Child taps "I understand" — records ConsentRecord and marks the device enrolled,
// per family-tier-spec.md §3.2 step 3 / system-architecture-spec.md §3.
devicesRouter.post("/:id/consent", asyncHandler(async (req, res) => {
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
}));

// Admin console dashboard — device list with last-synced, per offline-sync-spec.md §5.
// STORY-04: no longer accepts a family_id query param at all — scoped
// purely to the authenticated token's own family_id, so there is no input
// that can make this return another family's devices (closes the gap this
// story exists for, rather than just adding a login screen on top of it).
devicesRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, family_id, child_profile_id, platform, enrollment_status, last_synced_at, needs_attention, created_at
     FROM devices
     WHERE family_id = $1
     ORDER BY created_at DESC`,
    [req.auth!.family_id],
  );
  res.json(rows);
}));
