import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";

export const eventsRouter = Router();

interface UsageEventInput {
  client_event_id: string;
  start_ts: string;
  end_ts: string;
}

interface AlertEventInput {
  client_event_id: string;
  type: string;
  message?: string;
  ts: string;
}

function isUsageEvent(e: unknown): e is UsageEventInput {
  const x = e as Partial<UsageEventInput>;
  return typeof x?.client_event_id === "string" && typeof x?.start_ts === "string" && typeof x?.end_ts === "string";
}

function isAlertEvent(e: unknown): e is AlertEventInput {
  const x = e as Partial<AlertEventInput>;
  return typeof x?.client_event_id === "string" && typeof x?.type === "string" && typeof x?.ts === "string";
}

// Agent flushes its local queue here on every sync — offline-sync-spec.md §4
// step 1 (push, after the policy pull). Idempotent on client_event_id so a
// retried flush after a dropped connection can't double-count (§4 step 3).
eventsRouter.post("/:deviceId/events", asyncHandler(async (req, res) => {
  const { usage_events, alert_events } = req.body ?? {};
  const usageEvents: UsageEventInput[] = Array.isArray(usage_events) ? usage_events.filter(isUsageEvent) : [];
  const alertEvents: AlertEventInput[] = Array.isArray(alert_events) ? alert_events.filter(isAlertEvent) : [];

  if (usageEvents.length === 0 && alertEvents.length === 0) {
    return res.status(400).json({ error: "at least one valid usage_event or alert_event is required" });
  }

  const device = await pool.query("SELECT id FROM devices WHERE id = $1", [req.params.deviceId]);
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found" });

  let usageInserted = 0;
  for (const e of usageEvents) {
    const { rowCount } = await pool.query(
      `INSERT INTO usage_events (device_id, client_event_id, start_ts, end_ts)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id, client_event_id) DO NOTHING`,
      [req.params.deviceId, e.client_event_id, e.start_ts, e.end_ts],
    );
    usageInserted += rowCount ?? 0;
  }

  let alertInserted = 0;
  for (const e of alertEvents) {
    const { rowCount } = await pool.query(
      `INSERT INTO alert_events (device_id, client_event_id, type, message, ts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (device_id, client_event_id) DO NOTHING`,
      [req.params.deviceId, e.client_event_id, e.type, e.message ?? null, e.ts],
    );
    alertInserted += rowCount ?? 0;
  }

  await pool.query("UPDATE devices SET last_synced_at = now() WHERE id = $1", [req.params.deviceId]);

  res.status(201).json({
    usage_events_received: usageEvents.length,
    usage_events_inserted: usageInserted,
    alert_events_received: alertEvents.length,
    alert_events_inserted: alertInserted,
  });
}));
