import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const childrenRouter = Router();

// STORY-09: a child profile is what Policy and (via devices.child_profile_id)
// multiple devices attach to — created under the authenticated family, same
// as every other authenticated route (no :id in the URL; "my own family" is
// always implied by the token, matching devices.ts's existing shape).
childrenRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const { name, age_band } = req.body ?? {};
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  const { rows } = await pool.query(
    `INSERT INTO child_profiles (family_id, name, age_band)
     VALUES ($1, $2, $3)
     RETURNING id, family_id, name, age_band, created_at`,
    [req.auth!.family_id, name.trim(), age_band ?? null],
  );
  res.status(201).json(rows[0]);
}));

childrenRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, family_id, name, age_band, created_at FROM child_profiles WHERE family_id = $1 ORDER BY created_at",
    [req.auth!.family_id],
  );
  res.json(rows);
}));
