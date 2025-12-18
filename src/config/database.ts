// src/config/database.ts
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration from environment variables
const config: sql.config = {
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'wiseia_Antigravity',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true,
    },
    pool: {
        max: parseInt(process.env.DB_POOL_MAX || '10'),
        min: parseInt(process.env.DB_POOL_MIN || '0'),
        idleTimeoutMillis: 30000,
    },
};

// Connection pool
let pool: sql.ConnectionPool | null = null;

/**
 * Get database connection pool (singleton)
 */
export async function getPool(): Promise<sql.ConnectionPool> {
    if (!pool) {
        pool = await sql.connect(config);
        console.log('✅ Connected to SQL Server database:', config.database);
    }
    return pool;
}

/**
 * Execute a query with parameters
 */
export async function query<T = any>(
    queryString: string,
    params?: Record<string, any>
): Promise<T[]> {
    const poolConnection = await getPool();
    const request = poolConnection.request();

    // Add parameters if provided
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            request.input(key, value);
        });
    }

    const result = await request.query(queryString);
    return result.recordset as T[];
}

/**
 * Execute a stored procedure
 */
export async function executeProcedure<T = any>(
    procedureName: string,
    params?: Record<string, any>
): Promise<T[]> {
    const poolConnection = await getPool();
    const request = poolConnection.request();

    // Add parameters if provided
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            request.input(key, value);
        });
    }

    const result = await request.execute(procedureName);
    return result.recordset as T[];
}

/**
 * Close database connection
 */
export async function closeConnection(): Promise<void> {
    if (pool) {
        await pool.close();
        pool = null;
        console.log('❌ Database connection closed');
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    await closeConnection();
    process.exit(0);
});

export default { getPool, query, executeProcedure, closeConnection };
