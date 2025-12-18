// src/routes/api/v1/debug.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool } from '../../../db.js';

export const debugApiRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/v1/debug/notebooks-raw
     * Test raw SQL query
     */
    fastify.get('/debug/notebooks-raw', async (request, reply) => {
        try {
            const pool = await getPool();

            // Simple query without JOIN first
            const result1 = await pool.request().query('SELECT COUNT(*) as total FROM Notebooks');

            // Full query
            const result2 = await pool.request().query(`
        SELECT 
          n.NotebookID as id,
          n.Name as name,
          n.Description as description,
          n.Color as color
        FROM Notebooks n
        WHERE n.Active = 1
      `);

            reply.send({
                success: true,
                totalCount: result1.recordset[0].total,
                notebooks: result2.recordset,
                message: 'Direct SQL query successful'
            });
        } catch (error: any) {
            console.error('[DEBUG ERROR]', error);
            reply.status(500).send({
                error: error.message,
                stack: error.stack,
                code: error.code
            });
        }
    });
};
