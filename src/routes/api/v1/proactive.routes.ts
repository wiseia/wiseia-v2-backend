// src/routes/api/v1/proactive.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';
import {
    analyzeDocumentOnUpload,
    detectExpirations,
    suggestTags,
    summarizeDocument,
    ExpirationInfo
} from '../../../ai/proactiveAnalyzer.js';

export const proactiveApiRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /api/v1/proactive/analyze/:documentId
     * Trigger manual analysis of a document
     */
    fastify.post('/proactive/analyze/:documentId', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { documentId } = request.params;
            const user = request.user;

            fastify.log.info(`[Proactive] Manual analysis requested for document ${documentId}`);

            const metadata = await analyzeDocumentOnUpload(
                documentId,
                user.companyId,
                user.userId
            );

            return reply.send({
                success: true,
                data: metadata
            });
        } catch (error) {
            fastify.log.error({ error }, '[Proactive] Error in manual analysis');
            return reply.status(500).send({
                error: 'Erro ao analisar documento',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * GET /api/v1/proactive/insights/:documentId
     * Get AI-extracted insights for a document
     */
    fastify.get('/proactive/insights/:documentId', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { documentId } = request.params;
            const user = request.user;

            const pool = await getPool();

            // Get extracted metadata
            const metadataResult = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .query(`
          SELECT 
            MetadataKey,
            MetadataValue,
            ValueType,
            Confidence,
            ExtractedBy,
            CreatedAt
          FROM ExtractedMetadata
          WHERE DocumentID = @documentId
          ORDER BY CreatedAt DESC
        `);

            // Get document tags
            const tagsResult = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .query(`
          SELECT Tag, CreatedAt
          FROM DocumentTags
          WHERE DocumentID = @documentId
          ORDER BY CreatedAt DESC
        `);

            // Get document info with extracted dates
            const docResult = await pool
                .request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .query(`
          SELECT 
            Title,
            DocumentCategory,
            ExpirationDate,
            IssueDate,
            CreatedAt
          FROM Documents
          WHERE DocumentID = @documentId
        `);

            const doc = docResult.recordset[0];
            if (!doc) {
                return reply.status(404).send({ error: 'Documento não encontrado' });
            }

            // Generate summary if not already done
            let summary;
            try {
                summary = await summarizeDocument(documentId);
            } catch (err) {
                fastify.log.warn({ err }, 'Could not generate summary');
                summary = null;
            }

            return reply.send({
                success: true,
                data: {
                    document: {
                        title: doc.Title,
                        category: doc.DocumentCategory,
                        expirationDate: doc.ExpirationDate,
                        issueDate: doc.IssueDate,
                        createdAt: doc.CreatedAt
                    },
                    metadata: metadataResult.recordset,
                    tags: tagsResult.recordset.map((t: any) => t.Tag),
                    summary
                }
            });
        } catch (error) {
            fastify.log.error({ error }, '[Proactive] Error getting insights');
            return reply.status(500).send({
                error: 'Erro ao buscar insights',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * GET /api/v1/proactive/expirations
     * List documents expiring soon
     * Query params: days (default: 30)
     */
    fastify.get('/proactive/expirations', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { days = 30 } = request.query;
            const user = request.user;

            const pool = await getPool();
            const result = await pool
                .request()
                .input('companyId', sql.UniqueIdentifier, user.companyId)
                .input('daysAhead', sql.Int, parseInt(days))
                .query(`
          SELECT 
            DocumentID as id,
            Title as title,
            DocumentCategory as category,
            ExpirationDate as expirationDate,
            DATEDIFF(DAY, GETUTCDATE(), ExpirationDate) as daysUntilExpiration,
            CASE 
              WHEN DATEDIFF(DAY, GETUTCDATE(), ExpirationDate) <= 7 THEN 'urgent'
              WHEN DATEDIFF(DAY, GETUTCDATE(), ExpirationDate) <= 15 THEN 'high'
              WHEN DATEDIFF(DAY, GETUTCDATE(), ExpirationDate) <= 30 THEN 'medium'
              ELSE 'low'
            END as urgencyLevel
          FROM Documents
          WHERE 
            CompanyID = @companyId
            AND Active = 1
            AND ExpirationDate IS NOT NULL
            AND ExpirationDate >= GETUTCDATE()
            AND DATEDIFF(DAY, GETUTCDATE(), ExpirationDate) <= @daysAhead
          ORDER BY ExpirationDate ASC
        `);

            return reply.send({
                success: true,
                data: {
                    total: result.recordset.length,
                    expirations: result.recordset
                }
            });
        } catch (error) {
            fastify.log.error({ error }, '[Proactive] Error getting expirations');
            return reply.status(500).send({
                error: 'Erro ao buscar vencimentos',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * POST /api/v1/proactive/scan-company
     * Scan all company documents for issues and upcoming expirations
     */
    fastify.post('/proactive/scan-company', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const user = request.user;

            fastify.log.info(`[Proactive] Company scan requested by user ${user.userId}`);

            const pool = await getPool();

            // Get all active documents for this company
            const result = await pool
                .request()
                .input('companyId', sql.UniqueIdentifier, user.companyId)
                .query(`
          SELECT DocumentID, Title
          FROM Documents
          WHERE CompanyID = @companyId AND Active = 1
        `);

            const documents = result.recordset;
            const totalDocs = documents.length;
            let processed = 0;
            let errors = 0;

            fastify.log.info(`[Proactive] Starting scan of ${totalDocs} documents...`);

            // Process in background (don't wait for all)
            // In production, this should use a job queue
            const processingPromise = (async () => {
                for (const doc of documents) {
                    try {
                        await analyzeDocumentOnUpload(
                            doc.DocumentID,
                            user.companyId,
                            user.userId
                        );
                        processed++;
                    } catch (err) {
                        fastify.log.error({ err, documentId: doc.DocumentID }, 'Error processing document');
                        errors++;
                    }
                }
                fastify.log.info(`[Proactive] Scan complete: ${processed}/${totalDocs} processed, ${errors} errors`);
            })();

            // Return immediately, processing continues in background
            return reply.send({
                success: true,
                data: {
                    message: 'Análise em andamento',
                    totalDocuments: totalDocs,
                    status: 'processing'
                }
            });
        } catch (error) {
            fastify.log.error({ error }, '[Proactive] Error in company scan');
            return reply.status(500).send({
                error: 'Erro ao iniciar scan',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * GET /api/v1/proactive/tag-suggestions/:documentId
     * Get AI tag suggestions for a document
     */
    fastify.get('/proactive/tag-suggestions/:documentId', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { documentId } = request.params;

            const suggestions = await suggestTags(documentId);

            return reply.send({
                success: true,
                data: {
                    suggestions
                }
            });
        } catch (error) {
            fastify.log.error({ error }, '[Proactive] Error getting tag suggestions');
            return reply.status(500).send({
                error: 'Erro ao sugerir tags',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * GET /api/v1/proactive/summary/:documentId
     * Get AI-generated summary of document
     */
    fastify.get('/proactive/summary/:documentId', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const { documentId } = request.params;

            const summary = await summarizeDocument(documentId);

            return reply.send({
                success: true,
                data: summary
            });
        } catch (error) {
            fastify.log.error({ error }, '[Proactive] Error generating summary');
            return reply.status(500).send({
                error: 'Erro ao gerar resumo',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * GET /api/v1/proactive/health
     * Check if proactive analysis service is working
     */
    fastify.get('/proactive/health', async (request, reply) => {
        return reply.send({
            status: 'ok',
            service: 'WISEIA Proactive Analysis Service',
            features: [
                'Automatic document analysis',
                'Expiration detection',
                'Smart alerts generation',
                'Tag suggestions',
                'Document summarization'
            ],
            version: '1.0.0'
        });
    });
};
