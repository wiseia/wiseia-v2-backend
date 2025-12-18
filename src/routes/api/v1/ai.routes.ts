import { FastifyPluginAsync } from 'fastify';
import { askWithRag, analyzeMultipleDocuments, semanticSearch } from '../../../ai/ragService.js';

export const aiApiRoutes: FastifyPluginAsync = async (fastify) => {

    /**
     * POST /api/v1/ai/chat
     * Chat com RAG - responde perguntas baseadas em documentos
     */
    fastify.post('/ai/chat', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const user = request.user;
            const {
                question,
                department,
                documentType,
                documentIds,
                tags,
                dateFrom,
                dateTo
            } = request.body;

            if (!question || !question.trim()) {
                return reply.status(400).send({ error: 'Pergunta é obrigatória' });
            }

            const scope = {
                companyId: user.companyId,
                department,
                documentType,
                documentIds,
                tags,
                dateFrom: dateFrom ? new Date(dateFrom) : undefined,
                dateTo: dateTo ? new Date(dateTo) : undefined
            };

            console.log(`[AI API] Chat request from user ${user.userId}`);

            const result = await askWithRag(question, scope, {
                topK: 5,
                temperature: 0.2,
                includeContext: true
            });

            return reply.send({
                success: true,
                data: result
            });
        } catch (error) {
            fastify.log.error('[AI API] Error in chat:', error);
            return reply.status(500).send({
                error: 'Erro ao processar pergunta',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * POST /api/v1/ai/analyze-multi
     * Análise comparativa de múltiplos documentos
     */
    fastify.post('/ai/analyze-multi', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const user = request.user;
            const { documentIds, question } = request.body;

            if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
                return reply.status(400).send({ error: 'documentIds é obrigatório e deve ser um array' });
            }

            if (!question || !question.trim()) {
                return reply.status(400).send({ error: 'question é obrigatória' });
            }

            console.log(`[AI API] Multi-doc analysis: ${documentIds.length} docs`);

            const result = await analyzeMultipleDocuments(
                documentIds,
                question,
                user.companyId
            );

            return reply.send({
                success: true,
                data: result
            });
        } catch (error) {
            fastify.log.error('[AI API] Error in multi-doc analysis:', error);
            return reply.status(500).send({
                error: 'Erro ao analisar documentos',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * POST /api/v1/ai/search
     * Busca semântica em documentos
     */
    fastify.post('/ai/search', {
        preHandler: [fastify.authenticate as any]
    }, async (request: any, reply: any) => {
        try {
            const user = request.user;
            const {
                query,
                department,
                documentType,
                tags,
                limit = 10
            } = request.body;

            if (!query || !query.trim()) {
                return reply.status(400).send({ error: 'query é obrigatória' });
            }

            const scope = {
                companyId: user.companyId,
                department,
                documentType,
                tags
            };

            console.log(`[AI API] Semantic search: "${query}"`);

            const results = await semanticSearch(query, scope, limit);

            return reply.send({
                success: true,
                data: {
                    results,
                    total: results.length
                }
            });
        } catch (error) {
            fastify.log.error('[AI API] Error in semantic search:', error);
            return reply.status(500).send({
                error: 'Erro na busca semântica',
                message: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    });

    /**
     * GET /api/v1/ai/ping
     * Health check da IA
     */
    fastify.get('/ai/ping', async (request, reply) => {
        return reply.send({
            status: 'ok',
            service: 'WISEIA AI Service',
            model: 'gpt-4.1-mini',
            embedding: 'text-embedding-3-small',
            features: [
                'RAG Chat',
                'Multi-Document Analysis',
                'Semantic Search',
                'Context-Aware Responses'
            ]
        });
    });
};
