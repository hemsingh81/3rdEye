import bcrypt from "bcryptjs";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";

export const familiesRouter = Router();

// STORY-04: this is the registration step — a family and its first (parent)
// user are created together, since there's no way to log in to a family
// that has no user yet. No auth required here, same as any signup action.
familiesRouter.post("/", asyncHandler(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof email !== "string" || email.trim() === "") {
    return res.status(400).json({ error: "email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Transaction: a duplicate email must not leave an orphaned family row
  // behind — either both inserts succeed or neither does.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const family = await client.query(
      "INSERT INTO families (name) VALUES ($1) RETURNING id, name, created_at",
      [name.trim()],
    );
    const user = await client.query(
      `INSERT INTO users (family_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'parent')
       RETURNING id, email, role`,
      [family.rows[0].id, email.trim().toLowerCase(), passwordHash],
    );
    await client.query("COMMIT");
    res.status(201).json({ family: family.rows[0], user: user.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// STORY-16: nullable — most jurisdictions have no mandatory-notice
// requirement today, so leaving this unset is a valid, permanent state,
// not an onboarding step every family is forced through.
familiesRouter.put("/jurisdiction", requireAuth, asyncHandler(async (req, res) => {
  const { jurisdiction } = req.body ?? {};
  if (jurisdiction !== null && typeof jurisdiction !== "string") {
    return res.status(400).json({ error: "jurisdiction must be a string or null" });
  }
  const { rows } = await pool.query(
    "UPDATE families SET jurisdiction = $1 WHERE id = $2 RETURNING id, name, jurisdiction",
    [jurisdiction, req.auth!.family_id],
  );
  res.json(rows[0]);
}));
