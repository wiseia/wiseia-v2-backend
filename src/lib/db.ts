// src/lib/db.ts
import sql from "mssql";

const dbConfig: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 1433),
  database: process.env.DB_NAME,
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000
  },
  options: {
    trustServerCertificate: true,
  },
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .then((pool) => {
        console.log("[DB] Conectado ao SQL Server:", dbConfig.server);
        return pool;
      })
      .catch((err) => {
        console.error("[DB] Erro ao conectar no SQL Server:", err);
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

export async function query<T = any>(
  sqlQuery: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const pool = await getPool();
  const request = pool.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value as any);
    }
  }

  const result = await request.query<T>(sqlQuery);
  return result.recordset;
}
