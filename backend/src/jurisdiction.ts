import { pool } from "./db/pool.js";

// STORY-16: generic by design so Employer tier (Phase 4) can hang its own,
// larger jurisdiction table off this same shape without a rewrite — never
// Family-tier-specific logic, even though Family tier is the only caller
// today.

export async function getRequiredFeatures(jurisdiction: string | null): Promise<string[]> {
  if (!jurisdiction) return [];
  const { rows } = await pool.query(
    "SELECT required_features FROM jurisdiction_notice_requirements WHERE jurisdiction = $1",
    [jurisdiction],
  );
  return rows[0]?.required_features ?? [];
}

// Consent is recorded per-device (reusing consent_records, see migration
// 010) but checked family-wide — any device under this family having
// accepted the notice for a feature is enough, since the gated feature
// itself (e.g. a child's geofence policy) isn't device-scoped either.
export async function hasAcceptedJurisdictionNotice(familyId: string, feature: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM consent_records cr JOIN devices d ON d.id = cr.device_id
     WHERE d.family_id = $1 AND cr.feature = $2 LIMIT 1`,
    [familyId, feature],
  );
  return rows.length > 0;
}
