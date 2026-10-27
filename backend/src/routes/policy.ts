import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";

export const policyRouter = Router();

// Agent pulls this on enroll and on every sync (offline-sync-spec.md §4 step 1) —
// the agent caches it locally and enforces F1/F2 with zero backend round-trip.
policyRouter.get("/:deviceId/policy", asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT device_id, version, daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories, updated_at
     FROM policies WHERE device_id = $1`,
    [req.params.deviceId],
  );
  if (rows.length === 0) return res.status(404).json({ error: "no policy set for this device yet" });
  res.json(rows[0]);
}));

// Parent sets/edits policy from the dashboard's policy editor — family-tier-spec.md §3.4.
policyRouter.put("/:deviceId/policy", asyncHandler(async (req, res) => {
  const { daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories } = req.body ?? {};
  if (typeof daily_limit_minutes !== "number" || daily_limit_minutes < 0) {
    return res.status(400).json({ error: "daily_limit_minutes must be a non-negative number" });
  }
  if (!Array.isArray(content_filter_categories) || !content_filter_categories.every((c) => typeof c === "string")) {
    return res.status(400).json({ error: "content_filter_categories must be an array of strings" });
  }
  const device = await pool.query("SELECT id FROM devices WHERE id = $1", [req.params.deviceId]);
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found" });

  const { rows } = await pool.query(
    `INSERT INTO policies (device_id, version, daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories, updated_at)
     VALUES ($1, 1, $2, $3, $4, $5, now())
     ON CONFLICT (device_id) DO UPDATE SET
       version = policies.version + 1,
       daily_limit_minutes = EXCLUDED.daily_limit_minutes,
       bedtime_start = EXCLUDED.bedtime_start,
       bedtime_end = EXCLUDED.bedtime_end,
       content_filter_categories = EXCLUDED.content_filter_categories,
       updated_at = now()
     RETURNING device_id, version, daily_limit_minutes, bedtime_start, bedtime_end, content_filter_categories, updated_at`,
    [req.params.deviceId, daily_limit_minutes, bedtime_start ?? null, bedtime_end ?? null, content_filter_categories],
  );
  res.json(rows[0]);
}));
