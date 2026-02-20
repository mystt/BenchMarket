import { config } from "../config.js";
import pg from "pg";
import { memoryQuery } from "./memory-db.js";

export type QueryResult<T = unknown> = { rows: T[]; rowCount: number };

let pgPool: pg.Pool | null = null;

function getPg(): pg.Pool {
  if (!pgPool) {
    pgPool = new pg.Pool({ connectionString: config.databaseUrl });
  }
  return pgPool;
}

export async function query<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = params ?? [];

  if (config.useSqlite) {
    return memoryQuery<T>(text, p);
  }

  const pool = getPg();
  const result = await pool.query<T>(text, p);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

export function getPool(): pg.Pool | null {
  return config.useSqlite ? null : getPg();
}

export function close(): void {
  if (pgPool) {
    pgPool.end();
    pgPool = null;
  }
}
