import pg from "pg";

const { Pool } = pg;

export const databaseUrl = process.env.DATABASE_URL;

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("railway.app")
        ? {
            rejectUnauthorized: false
          }
        : undefined
    })
  : null;

export async function checkDatabase() {
  if (!pool) {
    return {
      configured: false,
      connected: false,
      message: "DATABASE_URL is not set"
    };
  }

  try {
    const result = await pool.query<{ now: Date }>("select now()");

    return {
      configured: true,
      connected: true,
      time: result.rows[0]?.now
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      message: error instanceof Error ? error.message : "Unknown database error"
    };
  }
}
