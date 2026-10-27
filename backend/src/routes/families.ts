import { Router } from "express";
import { pool } from "../db/pool.js";
import { asyncHandler } from "../asyncHandler.js";

export const familiesRouter = Router();

familiesRouter.post("/", asyncHandler(async (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required" });
  }
  const { rows } = await pool.query(
    "INSERT INTO families (name) VALUES ($1) RETURNING id, name, created_at",
    [name.trim()],
  );
  res.status(201).json(rows[0]);
}));
