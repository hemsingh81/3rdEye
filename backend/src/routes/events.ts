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

// STORY-13: the agent's own on-device geofence check decides entry/exit —
// this is just the location history log; the human-facing alert ("Arrived
// at: School") is a normal AlertEventInput, flushed through the same
// batch, not a new mechanism.
interface LocationEventInput {
  client_event_id: string;
  lat: number;
  lon: number;
  geofence_id?: string;
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

function isLocationEvent(e: unknown): e is LocationEventInput {
  const x = e as Partial<LocationEventInput>;
  return typeof x?.client_event_id === "string" && typeof x?.lat === "number" && typeof x?.lon === "number" && typeof x?.ts === "string";
}

// Agent flushes its local queue here on every sync — offline-sync-spec.md §4
// step 1 (push, after the policy pull). Idempotent on client_event_id so a
// retried flush after a dropped connection can't double-count (§4 step 3).
eventsRouter.post("/:deviceId/events", asyncHandler(async (req, res) => {
  const { usage_events, alert_events, location_events } = req.body ?? {};
  const usageEvents: UsageEventInput[] = Array.isArray(usage_events) ? usage_events.filter(isUsageEvent) : [];
  const alertEvents: AlertEventInput[] = Array.isArray(alert_events) ? alert_events.filter(isAlertEvent) : [];
  const locationEvents: LocationEventInput[] = Array.isArray(location_events) ? location_events.filter(isLocationEvent) : [];

  if (usageEvents.length === 0 && alertEvents.length === 0 && locationEvents.length === 0) {
    return res.status(400).json({ error: "at least one valid usage_event, alert_event, or location_event is required" });
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

  let locationInserted = 0;
  for (const e of locationEvents) {
    const { rowCount } = await pool.query(
      `INSERT INTO location_events (device_id, client_event_id, lat, lon, geofence_id, ts)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (device_id, client_event_id) DO NOTHING`,
      [req.params.deviceId, e.client_event_id, e.lat, e.lon, e.geofence_id ?? null, e.ts],
    );
    locationInserted += rowCount ?? 0;
  }

  // STORY-03: a real sync clears "needs attention" — the whole point of
  // the flag is to surface *prolonged silence*, not to stay stuck on once
  // the device is talking to the backend again.
  await pool.query("UPDATE devices SET last_synced_at = now(), needs_attention = false WHERE id = $1", [req.params.deviceId]);

  res.status(201).json({
    usage_events_received: usageEvents.length,
    usage_events_inserted: usageInserted,
    alert_events_received: alertEvents.length,
    alert_events_inserted: alertInserted,
    location_events_received: locationEvents.length,
    location_events_inserted: locationInserted,
  });
}));
