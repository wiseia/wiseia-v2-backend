// src/routes/api/v1/alerts.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';
import { randomUUID } from 'crypto';

export const alertsApiRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/v1/alerts
     * List alerts for user
     */
    fastify.get('/alerts', async (request, reply) => {
        try {
            const { includeRead } = request.query as { includeRead?: string };

            const pool = await getPool();
            const sqlRequest = pool.request();

            let whereClause = 'WHERE a.Active = 1';

            if (includeRead !== 'true') {
                whereClause += ' AND a.IsRead = 0';
            }

            const result = await sqlRequest.query(`
        SELECT 
          a.AlertID as id,
          a.Type as type,
          a.Priority as priority,
          a.Title as title,
          a.Message as message,
          a.IsRead as [read],
          a.CreatedAt as timestamp,
          a.DocumentID as documentId,
          d.Title as documentName
        FROM Alerts a
        LEFT JOIN Documents d ON a.DocumentID = d.DocumentID
        ${whereClause}
        ORDER BY a.CreatedAt DESC
      `);

            reply.send(result.recordset);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to list alerts' });
        }
    });

    /**
     * GET /api/v1/alerts/:id
     * Get alert by ID
     */
    fastify.get('/alerts/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            const result = await pool
                .request()
                .input('alertId', sql.UniqueIdentifier, id)
                .query(`
          SELECT 
            a.*,
            d.Title as documentName
          FROM Alerts a
          LEFT JOIN Documents d ON a.DocumentID = d.DocumentID
          WHERE a.AlertID = @alertId AND a.Active = 1
        `);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Alert not found' });
            }

            reply.send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to get alert' });
        }
    });

    /**
     * PATCH /api/v1/alerts/:id/read
     * Mark alert as read
     */
    fastify.patch('/alerts/:id/read', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            await pool
                .request()
                .input('alertId', sql.UniqueIdentifier, id)
                .query(`
          UPDATE Alerts
          SET IsRead = 1, ReadAt = GETUTCDATE()
          WHERE AlertID = @alertId AND Active = 1
        `);

            reply.status(204).send();
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to mark alert as read' });
        }
    });

    /**
     * POST /api/v1/alerts/mark-all-read
     * Mark all alerts as read
     */
    fastify.post('/alerts/mark-all-read', async (request, reply) => {
        try {
            const pool = await getPool();
            await pool.request().query(`
        UPDATE Alerts
        SET IsRead = 1, ReadAt = GETUTCDATE()
        WHERE IsRead = 0 AND Active = 1
      `);

            reply.status(204).send();
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to mark all alerts as read' });
        }
    });

    /**
     * DELETE /api/v1/alerts/:id
     * Dismiss alert
     */
    fastify.delete('/alerts/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            await pool
                .request()
                .input('alertId', sql.UniqueIdentifier, id)
                .query(`
          UPDATE Alerts
          SET Active = 0
          WHERE AlertID = @alertId
        `);

            reply.status(204).send();
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to dismiss alert' });
        }
    });

    /**
     * POST /api/v1/alerts
     * Create alert
     */
    fastify.post('/alerts', async (request, reply) => {
        try {
            const { type, priority, title, message, documentId, triggerDate } = request.body as any;

            if (!type || !title || !message) {
                return reply.status(400).send({ error: 'Type, title and message are required' });
            }

            const alertId = randomUUID();

            const pool = await getPool();
            const result = await pool
                .request()
                .input('alertId', sql.UniqueIdentifier, alertId)
                .input('type', sql.NVarChar(50), type)
                .input('priority', sql.NVarChar(20), priority || 'medium')
                .input('title', sql.NVarChar(500), title)
                .input('message', sql.NVarChar(sql.MAX), message)
                .input('documentId', sql.UniqueIdentifier, documentId || null)
                .input('triggerDate', sql.DateTime2, triggerDate || null)
                .input('createdBy', sql.UniqueIdentifier, null) // TODO: Get from JWT
                .query(`
          INSERT INTO Alerts (
            AlertID, Type, Priority, Title, Message,
            DocumentID, TriggerDate, CreatedBy
          )
          VALUES (
            @alertId, @type, @priority, @title, @message,
            @documentId, @triggerDate, @createdBy
          );
          
          SELECT * FROM Alerts WHERE AlertID = @alertId;
        `);

            reply.status(201).send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to create alert' });
        }
    });

    /**
     * GET /api/v1/alerts/summary
     * Get alerts summary
     */
    fastify.get('/alerts/summary', async (request, reply) => {
        try {
            const pool = await getPool();
            const result = await pool.request().query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN IsRead = 0 THEN 1 ELSE 0 END) as unread,
          SUM(CASE WHEN Priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
          SUM(CASE WHEN Priority = 'high' THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN Priority = 'medium' THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN Priority = 'low' THEN 1 ELSE 0 END) as low
        FROM Alerts
        WHERE Active = 1
      `);

            const row = result.recordset[0];

            reply.send({
                total: row.total,
                unread: row.unread,
                byPriority: {
                    urgent: row.urgent,
                    high: row.high,
                    medium: row.medium,
                    low: row.low,
                },
            });
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to get alerts summary' });
        }
    });
};
