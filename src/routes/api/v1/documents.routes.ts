// src/routes/api/v1/documents.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';
import multipart from '@fastify/multipart';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export const documentsApiRoutes: FastifyPluginAsync = async (fastify) => {
    // Register multipart for file uploads
    await fastify.register(multipart);

    /**
     * GET /api/v1/documents
     * List documents with optional filters
     */
    fastify.get('/documents', async (request, reply) => {
        try {
            const {
                query: queryText,
                notebookId,
                tags,
                dateFrom,
                dateTo,
                limit = 50,
                offset = 0,
            } = request.query as any;

            const pool = await getPool();
            const sqlRequest = pool.request();

            let whereConditions = ['d.Active = 1'];

            if (notebookId) {
                whereConditions.push('d.NotebookID = @notebookId');
                sqlRequest.input('notebookId', sql.UniqueIdentifier, notebookId);
            }

            if (dateFrom) {
                whereConditions.push('d.CreatedAt >= @dateFrom');
                sqlRequest.input('dateFrom', sql.DateTime2, dateFrom);
            }

            if (dateTo) {
                whereConditions.push('d.CreatedAt <= @dateTo');
                sqlRequest.input('dateTo', sql.DateTime2, dateTo);
            }

            const whereClause = whereConditions.length > 0
                ? 'WHERE ' + whereConditions.join(' AND ')
                : '';

            const queryString = `
SELECT
d.DocumentID as id,
    d.Title as title,
    d.FileName as fileName,
    d.FileType as fileType,
    d.FileSize as fileSize,
    d.NotebookID as notebookId,
    d.Status as status,
    d.CreatedAt as uploadedAt,
    d.CreatedBy as uploadedBy,
    u.FullName as uploadedByName
        FROM Documents d
        LEFT JOIN Users u ON d.CreatedBy = u.UserID
        ${whereClause}
        ORDER BY d.CreatedAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
    `;

            sqlRequest.input('limit', sql.Int, limit);
            sqlRequest.input('offset', sql.Int, offset);

            const result = await sqlRequest.query(queryString);

            reply.send(result.recordset);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to list documents' });
        }
    });

    /**
     * GET /api/v1/documents/:id
     * Get document by ID
     */
    fastify.get('/documents/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            const result = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, id)
                .query(`
SELECT
d.*,
    u.FullName as uploadedByName
          FROM Documents d
          LEFT JOIN Users u ON d.CreatedBy = u.UserID
          WHERE d.DocumentID = @documentId AND d.Active = 1
    `);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Document not found' });
            }

            reply.send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to get document' });
        }
    });

    /**
     * POST /api/v1/documents
     * Upload new document
     */
    fastify.post('/documents', async (request, reply) => {
        try {
            const data = await request.file();

            if (!data) {
                return reply.status(400).send({ error: 'No file uploaded' });
            }

            const buffer = await data.toBuffer();
            const documentId = randomUUID();
            const fileName = data.filename;
            const fileType = path.extname(fileName);
            const fileSize = buffer.length;

            // Save file to disk
            const uploadDir = process.env.UPLOAD_DIR || './uploads';
            await fs.mkdir(uploadDir, { recursive: true });

            const filePath = path.join(uploadDir, `${documentId}${fileType} `);
            await fs.writeFile(filePath, buffer);

            // Get fields from multipart
            const fields = data.fields as any;
            const notebookId = fields.notebookId?.value;
            const tagsStr = fields.tags?.value;
            const extractMetadata = fields.extractMetadata?.value === 'true';

            // Insert into database
            const pool = await getPool();
            const result = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('fileName', sql.NVarChar(255), fileName)
                .input('fileType', sql.NVarChar(50), fileType)
                .input('fileSize', sql.BigInt, fileSize)
                .input('filePath', sql.NVarChar(512), filePath)
                .input('title', sql.NVarChar(500), fileName)
                .input('notebookId', sql.UniqueIdentifier, notebookId || null)
                .input('status', sql.NVarChar(50), 'processing')
                .input('createdBy', sql.UniqueIdentifier, null) // TODO: Get from JWT
                .query(`
          INSERT INTO Documents(
        DocumentID, FileName, FileType, FileSize, FilePath,
        Title, NotebookID, Status, CreatedBy
    )
VALUES(
    @documentId, @fileName, @fileType, @fileSize, @filePath,
    @title, @notebookId, @status, @createdBy
);

SELECT * FROM Documents WHERE DocumentID = @documentId;
`);

            // TODO: Process document (extract chunks, embeddings, metadata)
            // This should be done async in background

            reply.status(201).send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to upload document' });
        }
    });

    /**
     * PATCH /api/v1/documents/:id
     * Update document metadata
     */
    fastify.patch('/documents/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };
            const { title, notebookId, tags } = request.body as any;

            const pool = await getPool();
            const sqlRequest = pool.request();

            let updateFields: string[] = [];

            if (title !== undefined) {
                updateFields.push('Title = @title');
                sqlRequest.input('title', sql.NVarChar(500), title);
            }

            if (notebookId !== undefined) {
                updateFields.push('NotebookID = @notebookId');
                sqlRequest.input('notebookId', sql.UniqueIdentifier, notebookId);
            }

            if (updateFields.length === 0) {
                return reply.status(400).send({ error: 'No fields to update' });
            }

            updateFields.push('UpdatedAt = GETUTCDATE()');

            const result = await sqlRequest
                .input('documentId', sql.UniqueIdentifier, id)
                .query(`
          UPDATE Documents 
          SET ${updateFields.join(', ')}
          WHERE DocumentID = @documentId AND Active = 1;

SELECT * FROM Documents WHERE DocumentID = @documentId;
`);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Document not found' });
            }

            reply.send(result.recordset[0]);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to update document' });
        }
    });

    /**
     * DELETE /api/v1/documents/:id
     * Soft delete document
     */
    fastify.delete('/documents/:id', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, id)
                .query(`
          UPDATE Documents
          SET Active = 0, DeletedAt = GETUTCDATE()
          WHERE DocumentID = @documentId AND Active = 1
    `);

            reply.status(204).send();
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to delete document' });
        }
    });

    /**
     * GET /api/v1/documents/:id/download
     * Download document file
     */
    fastify.get('/documents/:id/download', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            const result = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, id)
                .query(`
          SELECT FilePath, FileName, FileType
          FROM Documents
          WHERE DocumentID = @documentId AND Active = 1
    `);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Document not found' });
            }

            const { FilePath, FileName } = result.recordset[0];

            const fileBuffer = await fs.readFile(FilePath);

            reply
                .header('Content-Disposition', `attachment; filename = "${FileName}"`)
                .type('application/octet-stream')
                .send(fileBuffer);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to download document' });
        }
    });

    /**
     * GET /api/v1/documents/:id/chunks
     * Get document chunks
     */
    fastify.get('/documents/:id/chunks', async (request, reply) => {
        try {
            const { id } = request.params as { id: string };

            const pool = await getPool();
            const result = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, id)
                .query(`
SELECT
    ChunkID as id,
    ChunkIndex as [index],
    ChunkText as text,
    PageNumber as pageNumber,
    TokenCount as tokenCount
          FROM DocumentChunks
          WHERE DocumentID = @documentId
          ORDER BY ChunkIndex
    `);

            reply.send(result.recordset);
        } catch (error) {
            fastify.log.error(error);
            reply.status(500).send({ error: 'Failed to get chunks' });
        }
    });
};
