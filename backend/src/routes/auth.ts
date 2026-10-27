import bcrypt from "bcryptjs";
import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";
import { signToken } from "../auth/jwt.js";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email and password are required" });
  }

  const { rows } = await pool.query(
    "SELECT id, family_id, password_hash, role FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  // Same generic message whether the email doesn't exist or the password is
  // wrong — distinguishing the two would tell an attacker which emails are
  // registered.
  if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: "invalid email or password" });
  }

  const user = rows[0];
  const token = signToken({ sub: user.id, family_id: user.family_id, role: user.role });
  res.json({ token });
}));
