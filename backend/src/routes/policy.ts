import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const policyRouter = Router();

// Agent pulls this on enroll and on every sync (offline-sync-spec.md §4 step 1) —
// the agent caches it locally and enforces F1/F2 with zero backend round-trip.
// STORY-09: resolves through the device's child_profile_id — the URL shape
// stays "my policy, by my device id" from the agent's perspective; it
// doesn't need to know a child profile exists. Two devices under the same
// child naturally return the identical row here.
policyRouter.get("/:deviceId/policy", asyncHandler(async (req, res) => {
  // Response keeps returning `device_id` (the requesting device's own id,
  // not the child_profile_id it resolved through) — the Windows and
  // Android agents' Policy model both deserialize that exact field name
  // already; changing the response shape here would silently break them
  // even though the *query* now resolves through the child.
  //
  // STORY-11 review catch: this endpoint never returned app_control_mode
  // or app_allowlist at all, even after STORY-10 added those columns —
  // meaning no agent could ever actually know what to block. Added here;
  // app_allowlist is flattened to a plain array of app_id strings (the
  // agent needs the id list for matching, not approved_at/approved_by).
  const { rows } = await pool.query(
    `SELECT d.id AS device_id, p.version, p.daily_limit_minutes, p.bedtime_start, p.bedtime_end,
            p.content_filter_categories, p.app_control_mode,
            COALESCE((SELECT jsonb_agg(e->>'app_id') FROM jsonb_array_elements(p.app_allowlist) e), '[]'::jsonb) AS app_allowlist,
            p.updated_at
     FROM policies p
     JOIN devices d ON d.child_profile_id = p.child_profile_id
     WHERE d.id = $1`,
    [req.params.deviceId],
  );
  if (rows.length === 0) return res.status(404).json({ error: "no policy set for this device yet" });
  res.json(rows[0]);
}));

// Parent sets/edits policy from the dashboard's policy editor —
// family-tier-spec.md §3.4. STORY-04: requires auth AND ownership — a
// device id alone doesn't reveal which family it belongs to. STORY-09:
// the policy is actually stored against the device's child_profile_id —
// editing it from *any* device belonging to that child updates the same
// row every other of that child's devices will see on their next pull.
policyRouter.put("/:deviceId/policy", requireAuth, asyncHandler(async (req, res) => {
  const { daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories } = req.body ?? {};
  if (typeof daily_limit_minutes !== "number" || daily_limit_minutes < 0) {
    return res.status(400).json({ error: "daily_limit_minutes must be a non-negative number" });
  }
  if (!Array.isArray(content_filter_categories) || !content_filter_categories.every((c) => typeof c === "string")) {
    return res.status(400).json({ error: "content_filter_categories must be an array of strings" });
  }
  // 404, not 403, on an ownership mismatch — this doesn't confirm the
  // device's existence to someone who isn't its owner. Also catches a
  // device with no child_profile_id assigned at all (child_profile_id IS
  // NULL never matches a real row here) — a new, valid failure state
  // STORY-09 introduces: policy can't be set until a device is assigned
  // to a child.
  const device = await pool.query(
    "SELECT child_profile_id FROM devices WHERE id = $1 AND family_id = $2 AND child_profile_id IS NOT NULL",
    [req.params.deviceId, req.auth!.family_id],
  );
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found, or not yet assigned to a child" });
  const childProfileId = device.rows[0].child_profile_id;

  const { rows } = await pool.query(
    `INSERT INTO policies (child_profile_id, version, daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories, updated_at)
     VALUES ($1, 1, $2, $3, $4, $5, now())
     ON CONFLICT (child_profile_id) DO UPDATE SET
       version = policies.version + 1,
       daily_limit_minutes = EXCLUDED.daily_limit_minutes,
       bedtime_start = EXCLUDED.bedtime_start,
       bedtime_end = EXCLUDED.bedtime_end,
       content_filter_categories = EXCLUDED.content_filter_categories,
       updated_at = now()
     RETURNING $6::uuid AS device_id, version, daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories,
       app_control_mode,
       COALESCE((SELECT jsonb_agg(e->>'app_id') FROM jsonb_array_elements(app_allowlist) e), '[]'::jsonb) AS app_allowlist,
       updated_at`,
    [childProfileId, daily_limit_minutes, bedtime_start ?? null, bedtime_end ?? null, content_filter_categories, req.params.deviceId],
  );
  res.json(rows[0]);
}));
