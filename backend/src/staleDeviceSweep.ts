import { pool } from "./db/pool.js";

// STORY-03: fires AlertEvent "device_needs_attention" exactly once per
// threshold-crossing (devices.needs_attention is the guard against
// re-firing every sweep run) — a scheduled setInterval in this same
// process, per implementation-plan.md §0.1's decision against a premature
// separate cron service. needs_attention clears automatically the next
// time the device actually syncs (see routes/events.ts, routes/devices.ts).
export async function runStaleDeviceSweep(): Promise<number> {
  // STORY-09: policies.device_id no longer exists — resolve the threshold
  // through the device's child_profile_id instead.
  const { rows } = await pool.query(
    `SELECT d.id
     FROM devices d
     LEFT JOIN policies p ON p.child_profile_id = d.child_profile_id
     WHERE d.last_synced_at IS NOT NULL
       AND d.needs_attention = false
       AND d.last_synced_at < now() - (COALESCE(p.stale_device_alert_threshold_hours, 24) || ' hours')::interval`,
  );

  for (const row of rows) {
    await pool.query("UPDATE devices SET needs_attention = true WHERE id = $1", [row.id]);
    await pool.query(
      `INSERT INTO alert_events (device_id, client_event_id, type, message, ts)
       VALUES ($1, $2, 'device_needs_attention', 'No sync received past the configured threshold.', now())`,
      [row.id, `stale-device-${row.id}-${Date.now()}`],
    );
  }

  return rows.length;
}

export function startStaleDeviceSweep(intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    runStaleDeviceSweep().catch((err) => console.error("stale-device sweep failed:", err));
  }, intervalMs);
}
