// src/infra/db/sqlServer.ts
import sql from 'mssql';

// ⚠️ AJUSTE ESSAS VARIÁVEIS PARA AS QUE VOCÊ REALMENTE USA .env
// Exemplo padrão:
const sqlConfig: sql.config = {
  user: process.env.DB_USER as string,
  password: process.env.DB_PASSWORD as string,
  server: process.env.DB_HOST as string,
  database: process.env.DB_NAME as string,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// Um único pool compartilhado para toda a app
const pool = new sql.ConnectionPool(sqlConfig);
export const sqlPool = pool;
