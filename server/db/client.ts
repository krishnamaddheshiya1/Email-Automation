import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;

export function isDbConfigured(): boolean {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  return Boolean(url && url.trim().length > 0);
}

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is not configured in environment variables.");
    }

    const isRemote =
      connectionString.includes("supabase.co") ||
      connectionString.includes("supabase.com") ||
      connectionString.includes("pooler.supabase.com") ||
      process.env.NODE_ENV === "production";

    pool = new Pool({
      connectionString,
      ssl: isRemote ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected error on idle database client", err);
    });
  }

  return pool;
}

export async function query<
  R extends QueryResultRow = QueryResultRow,
  I extends unknown[] = unknown[]
>(text: string, params?: I): Promise<QueryResult<R>> {
  if (!isDbConfigured() && !process.env.FORCE_LOCAL_DB) {
    throw new Error("DATABASE_URL is not configured in environment variables.");
  }
  const currentPool = getDbPool();
  try {
    return await currentPool.query<R>(text, params);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const code = (err as { code?: string })?.code;
    if (
      message.includes("Connection terminated") ||
      message.includes("connection timeout") ||
      message.includes("socket disconnected") ||
      code === "ECONNRESET" ||
      code === "57P01"
    ) {
      return await currentPool.query<R>(text, params);
    }
    throw err;
  }
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
