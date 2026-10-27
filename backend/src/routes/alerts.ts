import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const alertsRouter = Router();

// STORY-05: the admin console's alerts feed needs a read side for the
// alert_events STORY-01's events.ts only ever writes to. Authenticated +
// ownership-checked, same pattern as the policy editor's PUT (STORY-04) —
// 404, not a leaking 403, on a device that isn't this family's own.
alertsRouter.get("/:deviceId/alerts", requireAuth, asyncHandler(async (req, res) => {
  const device = await pool.query("SELECT id FROM devices WHERE id = $1 AND family_id = $2", [req.params.deviceId, req.auth!.family_id]);
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found" });

  const { rows } = await pool.query(
    `SELECT id, type, message, ts, acknowledged
     FROM alert_events
     WHERE device_id = $1
     ORDER BY ts DESC
     LIMIT 50`,
    [req.params.deviceId],
  );
  res.json(rows);
}));
