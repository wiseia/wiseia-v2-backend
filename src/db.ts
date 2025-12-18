// src/db.ts
import sql from 'mssql';
import dotenv from 'dotenv';

// Carrega o .env
dotenv.config();

const config: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST || 'localhost',            // 👈 agora vem direto do .env
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    min: process.env.DB_POOL_MIN ? Number(process.env.DB_POOL_MIN) : 1,
    max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 5,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log('[DB] Pool conectado ao SQL Server');
  }
  return pool;
}

export async function pingDB() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT 1 AS ok');
  console.log('[DB] ping ok =>', result.recordset[0].ok);
}

export { sql };
