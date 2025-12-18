// src/routes/api/v1/documents.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';
import multipart from '@fastify/multipart';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

// Document processing dependencies
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');  // CommonJS module
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// ===== HELPER FUNCTIONS FOR DOCUMENT PROCESSING =====

/**
 * Chunk text intelligently for RAG
 */
function chunkText(text: string, targetSize: number = 800, overlap: number = 100): Array<{ text: string, index: number, characterCount: number }> {
    if (!text || text.trim().length === 0) return [];

    const chunks: Array<{ text: string, index: number, characterCount: number }> = [];
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    let currentChunk = '';
    let chunkIndex = 0;
    let previousChunkEnd = '';

    for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();

        if (currentChunk.length > 0 && (currentChunk.length + trimmedParagraph.length) > targetSize) {
            const finalChunk = previousChunkEnd + currentChunk;
            chunks.push({
                text: finalChunk.trim(),
                index: chunkIndex++,
                characterCount: finalChunk.length
            });
            previousChunkEnd = currentChunk.slice(-overlap);
            currentChunk = trimmedParagraph + '\n\n';
        } else {
            currentChunk += trimmedParagraph + '\n\n';
        }
    }

    if (currentChunk.trim().length > 0) {
        const finalChunk = previousChunkEnd + currentChunk;
        chunks.push({
            text: finalChunk.trim(),
            index: chunkIndex++,
            characterCount: finalChunk.length
        });
    }

    return chunks;
}

/**
 * Extract text from different file types
 */
async function extractTextFromFile(filePath: string, fileType: string): Promise<{ text: string, metadata?: any }> {
    const normalizedType = fileType.toLowerCase();

    switch (normalizedType) {
        case '.txt':
            const txtBuffer = await fs.readFile(filePath);
            return { text: txtBuffer.toString('utf-8') };

        case '.csv':
            const csvContent = await fs.readFile(filePath, 'utf-8');
            const lines = csvContent.split('\n');
            const formattedLines = lines.map((line, index) =>
                index === 0 ? `Headers: ${line}` : `Row ${index}: ${line}`
            );
            return { text: formattedLines.join('\n') };

        case '.pdf':
            const pdfBuffer = await fs.readFile(filePath);
            const pdfData = await pdfParse(pdfBuffer);
            return {
                text: pdfData.text,
                metadata: { pageCount: pdfData.numpages }
            };

        case '.docx':
            const docxBuffer = await fs.readFile(filePath);
            const docxResult = await mammoth.extractRawText({ buffer: docxBuffer });
            return { text: docxResult.value };

        case '.xlsx':
        case '.xls':
            const workbook = XLSX.readFile(filePath);
            let allText = '';
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const sheetData = XLSX.utils.sheet_to_csv(sheet);
                allText += `\n=== Sheet: ${sheetName} ===\n${sheetData}\n`;
            }
            return {
                text: allText,
                metadata: { sheetCount: workbook.SheetNames.length }
            };

        default:
            throw new Error(`Unsupported file type: ${fileType}`);
    }
}

/**
 * Process document: extract text, create chunks, save to database
 */
async function processDocumentAsync(
    fastify: any,
    documentId: string,
    filePath: string,
    fileType: string
): Promise<void> {
    try {
        fastify.log.info({ documentId, fileType }, 'Starting document processing');

        // Extract text
        const { text, metadata } = await extractTextFromFile(filePath, fileType);

        if (!text || text.trim().length === 0) {
            throw new Error('No text extracted from document');
        }

        // Create chunks
        const chunks = chunkText(text);

        // Save chunks to database
        const pool = await getPool();

        for (const chunk of chunks) {
            const chunkId = randomUUID();
            await pool.request()
                .input('chunkId', sql.UniqueIdentifier, chunkId)
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('chunkIndex', sql.Int, chunk.index)
                .input('chunkText', sql.NVarChar(sql.MAX), chunk.text)
                .input('tokenCount', sql.Int, Math.ceil(chunk.text.length / 4))
                .query(`
                    INSERT INTO DocumentChunks (
                        ChunkID, DocumentID, ChunkIndex, ChunkText, TokenCount, CreatedAt
                    )
                    VALUES (
                        @chunkId, @documentId, @chunkIndex, @chunkText, @tokenCount, GETUTCDATE()
                    )
                `);
        }

        // Update document status
        await pool.request()
            .input('documentId', sql.UniqueIdentifier, documentId)
            .query(`
                UPDATE Documents 
                SET Status = 'processed', ProcessedAt = GETUTCDATE()
                WHERE DocumentID = @documentId
            `);

        fastify.log.info({ documentId, chunksCreated: chunks.length }, 'Document processed successfully');

        // Trigger proactive analysis automatically
        try {
            const { analyzeDocumentOnUpload } = await import('../../../ai/proactiveAnalyzer.js');

            // TODO: Get actual companyId from document/user context
            // For now, using a test companyId - should be retrieved from JWT or document metadata
            const companyId = '00000000-0000-0000-0000-000000000001'; // Placeholder

            await analyzeDocumentOnUpload(documentId, companyId);
            fastify.log.info({ documentId }, 'Proactive analysis completed');
        } catch (analysisError: any) {
            fastify.log.error({ error: analysisError.message, documentId }, 'Proactive analysis failed');
        }

    } catch (error: any) {
        fastify.log.error({ error: error.message, documentId }, 'Document processing failed');

        // Update document status to error
        try {
            const pool = await getPool();
            await pool.request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('error', sql.NVarChar(sql.MAX), error.message)
                .query(`
                    UPDATE Documents 
                    SET Status = 'error', ProcessingError = @error
                    WHERE DocumentID = @documentId
                `);
        } catch (dbError) {
            fastify.log.error({ dbError }, 'Failed to update error status');
        }
    }
}

// ===== END HELPER FUNCTIONS =====


export const documentsApiRoutes: FastifyPluginAsync = async (fastify) => {
    // Register multipart for file uploads
    await fastify.register(multipart);

    /**
     * GET /api/v1/documents
     * List documents with optional filters
     */
    fastify.get('/documents', {
        onRequest: [fastify.authenticate]
    }, async (request: any, reply) => {
        try {
            const {
                query: queryText,
                notebookId,
                departmentId,
                divisionId,
                tags,
                dateFrom,
                dateTo,
                limit = 50,
                offset = 0,
            } = request.query as any;

            const pool = await getPool();
            const sqlRequest = pool.request();

            // Get user info from JWT
            const userRole = request.user?.role || 'user';
            const userDepartmentId = request.user?.departmentId;
            const userDivisionId = request.user?.divisionId;
            const userId = request.user?.userId;
            const userCompanyId = request.user?.companyId;

            let whereConditions: string[] = ['d.Active = 1'];

            // SECURITY: Permission filtering based on 5-level role system
            if (userRole === 'superuser') {
                // Superuser: NO ACCESS to company documents (platform admin only)
                whereConditions.push('1 = 0'); // Block all documents
                fastify.log.warn('Superuser attempted to access company documents');
            } else if (userRole === 'master') {
                // Master: See ALL documents from their company
                whereConditions.push('d.CompanyID = @userCompanyId');
                sqlRequest.input('userCompanyId', sql.UniqueIdentifier, userCompanyId);
            } else if (userRole === 'manager') {
                // Manager: Only documents from their department + company
                whereConditions.push('d.CompanyID = @userCompanyId');
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM DocumentPermissions dp
                    WHERE dp.DocumentID = d.DocumentID
                    AND dp.DepartmentID = @userDepartmentId
                )`);
                sqlRequest.input('userCompanyId', sql.UniqueIdentifier, userCompanyId);
                sqlRequest.input('userDepartmentId', sql.UniqueIdentifier, userDepartmentId);
            } else if (userRole === 'coordinator') {
                // Coordinator: Only documents from their division + company
                whereConditions.push('d.CompanyID = @userCompanyId');
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM DocumentPermissions dp
                    WHERE dp.DocumentID = d.DocumentID
                    AND dp.DivisionID = @userDivisionId
                )`);
                sqlRequest.input('userCompanyId', sql.UniqueIdentifier, userCompanyId);
                sqlRequest.input('userDivisionId', sql.UniqueIdentifier, userDivisionId);
            } else {
                // User: ONLY their own documents + company
                whereConditions.push('d.CompanyID = @userCompanyId');
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM DocumentPermissions dp
                    WHERE dp.DocumentID = d.DocumentID
                    AND dp.UserID = @userId
                )`);
                sqlRequest.input('userCompanyId', sql.UniqueIdentifier, userCompanyId);
                sqlRequest.input('userId', sql.UniqueIdentifier, userId);
            }

            // Frontend filters (additional filtering on top of role permissions)
            if (departmentId) {
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM DocumentPermissions dp2
                    WHERE dp2.DocumentID = d.DocumentID AND dp2.DepartmentID = @departmentId
                )`);
                sqlRequest.input('departmentId', sql.UniqueIdentifier, departmentId);
            }

            if (divisionId) {
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM DocumentPermissions dp3
                    WHERE dp3.DocumentID = d.DocumentID AND dp3.DivisionID = @divisionId
                )`);
                sqlRequest.input('divisionId', sql.UniqueIdentifier, divisionId);
            }

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

            // Declare limit and offset BEFORE using in query
            sqlRequest.input('limit', sql.Int, parseInt(limit));
            sqlRequest.input('offset', sql.Int, parseInt(offset));

            const queryString = `
                SELECT
                    d.DocumentID as idDocumento,
                    d.Title as titulo,
                    d.FileName as nomeOriginal,
                    d.FileType as mime,
                    d.FileSize as tamanhoBytes,
                    d.NotebookID as notebookId,
                    d.Status as status,
                    d.CreatedAt as criadoEmUtc,
                    d.CreatedBy as uploadedBy,
                    u.FullName as uploadedByNome,
                    d.Active as isAtivo,
                    (
                        SELECT STRING_AGG(dept.Name, ', ')
                        FROM DocumentPermissions dp
                        INNER JOIN Departments dept ON dp.DepartmentID = dept.DepartmentID
                        WHERE dp.DocumentID = d.DocumentID
                    ) AS departamentoNome,
                    (
                        SELECT STRING_AGG(div.Name, ', ')
                        FROM DocumentPermissions dp
                        INNER JOIN Divisions div ON dp.DivisionID = div.DivisionID
                        WHERE dp.DocumentID = d.DocumentID
                    ) AS divisions
                FROM Documents d
                LEFT JOIN Users u ON d.CreatedBy = u.UserID
                ${whereClause}
                ORDER BY d.CreatedAt DESC
                OFFSET @offset ROWS
                FETCH NEXT @limit ROWS ONLY
            `;

            // DEBUG: Log query details
            fastify.log.info({
                userRole,
                userDepartmentId,
                userCompanyId,
                whereClause,
                queryString: queryString.substring(0, 200) + '...'
            }, '🔍 GET /documents query');

            const result = await sqlRequest.query(queryString);

            fastify.log.info({
                recordCount: result.recordset.length
            }, '📊 GET /documents result');

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
    fastify.post('/documents', {
        onRequest: [fastify.authenticate]
    }, async (request, reply) => {
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

            // NEW: Get departments and divisions for permissions
            const departmentIdsStr = fields.departmentIds?.value; // JSON array
            const divisionIdsStr = fields.divisionIds?.value;     // JSON array

            // DEBUG: Log what we received
            fastify.log.info({
                fieldsKeys: Object.keys(fields),
                departmentIdsStr,
                divisionIdsStr
            }, '🔍 Multipart fields received');

            // Insert into database
            const pool = await getPool();

            // Get user info from JWT
            const createdBy = (request as any).user?.userId;
            const companyId = (request as any).user?.companyId;

            // DEBUG: Log JWT contents
            fastify.log.info({
                hasUser: !!(request as any).user,
                userKeys: (request as any).user ? Object.keys((request as any).user) : [],
                createdBy,
                companyId
            }, '🔑 JWT User Data');

            if (!companyId) {
                fastify.log.error({ jwtUser: (request as any).user }, '❌ CompanyID NOT FOUND in JWT');
                return reply.status(400).send({ error: 'CompanyID not found in session' });
            }

            const result = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('fileName', sql.NVarChar(255), fileName)
                .input('fileType', sql.NVarChar(50), fileType)
                .input('fileSize', sql.BigInt, fileSize)
                .input('filePath', sql.NVarChar(512), filePath)
                .input('title', sql.NVarChar(500), fileName)
                .input('notebookId', sql.UniqueIdentifier, notebookId || null)
                .input('companyId', sql.UniqueIdentifier, companyId)
                .input('status', sql.NVarChar(50), 'processing')
                .input('createdBy', sql.UniqueIdentifier, createdBy || null)
                .query(`
          INSERT INTO Documents(
        DocumentID, FileName, FileType, FileSize, FilePath,
        Title, NotebookID, CompanyID, Status, CreatedBy, CreatedAt, Active
    )
VALUES(
    @documentId, @fileName, @fileType, @fileSize, @filePath,
    @title, @notebookId, @companyId, @status, @createdBy, GETUTCDATE(), 1
);

SELECT * FROM Documents WHERE DocumentID = @documentId;
`);

            // Save document permissions (departments + divisions)
            const departmentIds = departmentIdsStr ? JSON.parse(departmentIdsStr) : [];
            const divisionIds = divisionIdsStr ? JSON.parse(divisionIdsStr) : [];

            //  Validate: At least one department must be selected
            if (departmentIds.length === 0) {
                fastify.log.warn({ departmentIdsStr, parsedLength: departmentIds.length }, '⚠️ No departments - validation failed');
                return reply.status(400).send({
                    error: 'Pelo menos um departamento deve ser selecionado'
                });
            }

            // Get division -> department mapping
            const divisionDeptMap = new Map<string, string>();
            if (divisionIds.length > 0) {
                const divResult = await pool.request()
                    .input('divisionIds', sql.NVarChar(sql.MAX), JSON.stringify(divisionIds))
                    .query(`
                        SELECT DivisionID, DepartmentID 
                        FROM Divisions 
                        WHERE DivisionID IN (SELECT value FROM OPENJSON(@divisionIds))
                    `);

                for (const row of divResult.recordset) {
                    divisionDeptMap.set(row.DivisionID, row.DepartmentID);
                }
            }

            // Save permissions: departments with their divisions
            for (const deptId of departmentIds) {
                // Find divisions belonging to this department
                const deptDivisions = divisionIds.filter(divId => divisionDeptMap.get(divId) === deptId);

                if (deptDivisions.length > 0) {
                    // Save one row per division in this department
                    for (const divId of deptDivisions) {
                        await pool.request()
                            .input('documentId', sql.UniqueIdentifier, documentId)
                            .input('departmentId', sql.UniqueIdentifier, deptId)
                            .input('divisionId', sql.UniqueIdentifier, divId)
                            .input('createdBy', sql.UniqueIdentifier, createdBy || null)
                            .query(`
                                INSERT INTO DocumentPermissions (DocumentID, DepartmentID, DivisionID, AccessLevel, CreatedBy)
                                VALUES (@documentId, @departmentId, @divisionId, 'read', @createdBy)
                            `);
                    }
                } else {
                    // Department-level permission (all divisions)
                    await pool.request()
                        .input('documentId', sql.UniqueIdentifier, documentId)
                        .input('departmentId', sql.UniqueIdentifier, deptId)
                        .input('createdBy', sql.UniqueIdentifier, createdBy || null)
                        .query(`
                            INSERT INTO DocumentPermissions (DocumentID, DepartmentID, AccessLevel, CreatedBy)
                            VALUES (@documentId, @departmentId, 'read', @createdBy)
                        `);
                }
            }

            fastify.log.info({
                documentId,
                departmentsCount: departmentIds.length,
                divisionsCount: divisionIds.length
            }, 'Document permissions saved');

            // Process document asynchronously (don't block response)
            setImmediate(async () => {
                await processDocumentAsync(fastify, documentId, filePath, fileType);
            });

            reply.status(201).send(result.recordset[0]);
        } catch (error) {
            fastify.log.error({
                error,
                errorMessage: (error as any).message,
                errorStack: (error as any).stack
            }, '❌ Failed to upload document');
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
