// src/routes/api/v1/notebooks.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';
import { randomUUID } from 'crypto';

export const notebooksApiRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /api/v1/notebooks
     * List all notebooks
     */
    fastify.get('/notebooks', async (request, reply) => {
        try {
            const pool = await getPool();
            const result = await pool.request().query(`
        SELECT 
          n.NotebookID as id,
          n.Name as name,
          n.Description as description,
          n.Color as color,
          n.CreatedAt as createdAt,
          n.CreatedBy as createdBy,
          u.FullName as createdByName,
          COUNT(d.DocumentID) as documentCount
        FROM Notebooks n
        LEFT JOIN Users u ON n.CreatedBy = u.UserID
        LEFT JOIN Documents d ON n.NotebookID = d.NotebookID AND d.Active = 1
        WHERE n.Active = 1
        GROUP BY n.NotebookID, n.Name, n.Description, n.Color, n.CreatedAt, n.CreatedBy, u.FullName
        ORDER BY n.CreatedAt DESC
      `);

            reply.send(result.recordset);
        } catch (error) {
            console.error('[NOTEBOOKS GET ERROR]', error); // ADDED: Log real error
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to list notebooks' });
        }
    });

    /**
     * GET /api/v1/notebooks/:id
     * Get notebook by ID
     */
    fastify.get('/notebooks/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            const result = await pool
                .request()
                .input('notebookId', sql.UniqueIdentifier, id)
                .query(`
          SELECT 
            n.*,
            COUNT(d.DocumentID) as documentCount
          FROM Notebooks n
          LEFT JOIN Documents d ON n.NotebookID = d.NotebookID AND d.Active = 1
          WHERE n.NotebookID = @notebookId AND n.Active = 1
          GROUP BY n.NotebookID, n.Name, n.Description, n.Color, n.CompanyID, n.Active, 
                   n.CreatedAt, n.CreatedBy, n.UpdatedAt, n.UpdatedBy
        `);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Notebook not found' });
            }

            reply.send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to get notebook' });
        }
    });

    /**
     * POST /api/v1/notebooks
     * Create new notebook
     */
    fastify.post('/notebooks', async (request, reply) => {
        try {
            const { name, description, color } = request.body as any;

            if (!name) {
                return reply.status(400).send({ error: 'Name is required' });
            }

            const notebookId = randomUUID();

            const pool = await getPool();
            const result = await pool
                .request()
                .input('notebookId', sql.UniqueIdentifier, notebookId)
                .input('name', sql.NVarChar(255), name)
                .input('description', sql.NVarChar(sql.MAX), description || null)
                .input('color', sql.NVarChar(7), color || '#3b82f6')
                .input('createdBy', sql.UniqueIdentifier, null) // TODO: Get from JWT
                .query(`
          INSERT INTO Notebooks (NotebookID, Name, Description, Color, CreatedBy)
          VALUES (@notebookId, @name, @description, @color, @createdBy);
          
          SELECT * FROM Notebooks WHERE NotebookID = @notebookId;
        `);

            reply.status(201).send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to create notebook' });
        }
    });

    /**
     * PATCH /api/v1/notebooks/:id
     * Update notebook
     */
    fastify.patch('/notebooks/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };
            const { name, description, color } = request.body as any;

            const pool = await getPool();
            const sqlRequest = pool.request();

            let updateFields: string[] = [];

            if (name !== undefined) {
                updateFields.push('Name = @name');
                sqlRequest.input('name', sql.NVarChar(255), name);
            }

            if (description !== undefined) {
                updateFields.push('Description = @description');
                sqlRequest.input('description', sql.NVarChar(sql.MAX), description);
            }

            if (color !== undefined) {
                updateFields.push('Color = @color');
                sqlRequest.input('color', sql.NVarChar(7), color);
            }

            if (updateFields.length === 0) {
                return reply.status(400).send({ error: 'No fields to update' });
            }

            updateFields.push('UpdatedAt = GETUTCDATE()');

            const result = await sqlRequest
                .input('notebookId', sql.UniqueIdentifier, id)
                .query(`
          UPDATE Notebooks
          SET ${updateFields.join(', ')}
          WHERE NotebookID = @notebookId AND Active = 1;
          
          SELECT * FROM Notebooks WHERE NotebookID = @notebookId;
        `);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Notebook not found' });
            }

            reply.send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to update notebook' });
        }
    });

    /**
     * DELETE /api/v1/notebooks/:id
     * Delete notebook (soft delete)
     */
    fastify.delete('/notebooks/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            await pool
                .request()
                .input('notebookId', sql.UniqueIdentifier, id)
                .query(`
          UPDATE Notebooks
          SET Active = 0
          WHERE NotebookID = @notebookId AND Active = 1
        `);

            reply.status(204).send();
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to delete notebook' });
        }
    });

    /**
     * GET /api/v1/notebooks/:id/documents
     * Get documents in notebook
     */
    fastify.get('/notebooks/:id/documents', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            const result = await pool
                .request()
                .input('notebookId', sql.UniqueIdentifier, id)
                .query(`
          SELECT 
            d.DocumentID as id,
            d.Title as title,
            d.FileName as fileName,
            d.FileType as fileType,
            d.FileSize as fileSize,
            d.Status as status,
            d.CreatedAt as uploadedAt,
            u.FullName as uploadedByName
          FROM Documents d
          LEFT JOIN Users u ON d.CreatedBy = u.UserID
          WHERE d.NotebookID = @notebookId AND d.Active = 1
          ORDER BY d.CreatedAt DESC
        `);

            reply.send(result.recordset);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to get notebook documents' });
        }
    });
};
