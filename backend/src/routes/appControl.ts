import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const appControlRouter = Router();

interface InstalledAppInput {
  app_id: string;
  install_source?: string;
}

function isInstalledApp(a: unknown): a is InstalledAppInput {
  const x = a as Partial<InstalledAppInput>;
  return typeof x?.app_id === "string";
}

// Agent reports its installed-app inventory — device-channel, unauthenticated,
// same trust boundary as events.ts (system-architecture-spec.md §2.1).
appControlRouter.post("/:deviceId/installed-apps", asyncHandler(async (req, res) => {
  const { apps } = req.body ?? {};
  const list: InstalledAppInput[] = Array.isArray(apps) ? apps.filter(isInstalledApp) : [];
  if (list.length === 0) return res.status(400).json({ error: "at least one app with an app_id is required" });

  const device = await pool.query("SELECT id FROM devices WHERE id = $1", [req.params.deviceId]);
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found" });

  for (const app of list) {
    await pool.query(
      `INSERT INTO installed_app_events (device_id, app_id, install_source, detected_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (device_id, app_id) DO UPDATE SET
         install_source = EXCLUDED.install_source,
         detected_at = now()`,
      [req.params.deviceId, app.app_id, app.install_source ?? null],
    );
  }
  res.status(201).json({ reported: list.length });
}));

// Admin console's "Installed apps" panel — authenticated + ownership-checked,
// same 404-not-403 pattern as the policy editor (STORY-04). is_approved is
// computed here against the child's app_allowlist, not stored redundantly.
appControlRouter.get("/:deviceId/installed-apps", requireAuth, asyncHandler(async (req, res) => {
  const device = await pool.query(
    "SELECT child_profile_id FROM devices WHERE id = $1 AND family_id = $2",
    [req.params.deviceId, req.auth!.family_id],
  );
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found" });
  const childProfileId = device.rows[0].child_profile_id;

  const policy = childProfileId
    ? await pool.query("SELECT app_allowlist FROM policies WHERE child_profile_id = $1", [childProfileId])
    : { rows: [] as { app_allowlist: { app_id: string }[] }[] };
  const allowlist: { app_id: string }[] = policy.rows[0]?.app_allowlist ?? [];
  const approvedIds = new Set(allowlist.map((a) => a.app_id));

  const { rows } = await pool.query(
    "SELECT app_id, install_source, detected_at FROM installed_app_events WHERE device_id = $1 ORDER BY detected_at DESC",
    [req.params.deviceId],
  );
  res.json(rows.map((r) => ({ ...r, is_approved: approvedIds.has(r.app_id) })));
}));

// Parent approves or blocks (revokes approval for) a specific app —
// family-tier-spec.md §2 item 2. Updates the SAME policies row STORY-09
// made child-scoped, so approving an app from one device's dashboard view
// approves it for every device that child has.
appControlRouter.put("/:deviceId/policy/apps", requireAuth, asyncHandler(async (req, res) => {
  const { app_id, approved } = req.body ?? {};
  if (typeof app_id !== "string" || typeof approved !== "boolean") {
    return res.status(400).json({ error: "app_id (string) and approved (boolean) are required" });
  }

  const device = await pool.query(
    "SELECT child_profile_id FROM devices WHERE id = $1 AND family_id = $2 AND child_profile_id IS NOT NULL",
    [req.params.deviceId, req.auth!.family_id],
  );
  if (device.rows.length === 0) return res.status(404).json({ error: "device not found, or not yet assigned to a child" });
  const childProfileId = device.rows[0].child_profile_id;

  // Ensure a policy row exists before either branch below — otherwise
  // blocking an app for a child with no policy set yet would silently
  // match zero rows and the final SELECT would return nothing.
  await pool.query("INSERT INTO policies (child_profile_id) VALUES ($1) ON CONFLICT (child_profile_id) DO NOTHING", [childProfileId]);

  if (approved) {
    const entry = { app_id, approved_at: new Date().toISOString(), approved_by: req.auth!.sub };
    await pool.query(
      `UPDATE policies
       SET app_allowlist = CASE
             WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(app_allowlist) e WHERE e->>'app_id' = $2)
             THEN app_allowlist
             ELSE app_allowlist || $3::jsonb
           END,
           version = version + 1,
           updated_at = now()
       WHERE child_profile_id = $1`,
      [childProfileId, app_id, JSON.stringify([entry])],
    );
  } else {
    await pool.query(
      `UPDATE policies
       SET app_allowlist = COALESCE(
             (SELECT jsonb_agg(e) FROM jsonb_array_elements(app_allowlist) e WHERE e->>'app_id' != $2),
             '[]'::jsonb
           ),
           version = version + 1,
           updated_at = now()
       WHERE child_profile_id = $1`,
      [childProfileId, app_id],
    );
  }

  const { rows } = await pool.query("SELECT app_allowlist, version FROM policies WHERE child_profile_id = $1", [childProfileId]);
  res.json(rows[0]);
}));
