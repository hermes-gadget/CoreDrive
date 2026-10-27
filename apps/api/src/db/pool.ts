import pg from "pg";
import { config } from "../config.js";

export const pool: pg.Pool | null = config.DATABASE_URL
  ? new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30000,
    })
  : null;

export async function checkDb(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
}
