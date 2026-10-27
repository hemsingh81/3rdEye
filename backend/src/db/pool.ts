import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://3rdeye:3rdeye@localhost:5432/3rdeye",
});
