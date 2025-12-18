// src/routes/api/v1/index.ts
import { FastifyPluginAsync } from 'fastify';
import { documentsApiRoutes } from './documents.routes.js';
import { notebooksApiRoutes } from './notebooks.routes.js';
import { alertsApiRoutes } from './alerts.routes.js';
import { documentTypesApiRoutes } from './document-types.routes.js';
import { aiApiRoutes } from './ai.routes.js';
import { proactiveApiRoutes } from './proactive.routes.js';
import { departamentosV1Routes } from './departamentos.routes.js';

/**
 * API v1 Routes
 * All routes under /api/v1
 */
export const apiV1Routes: FastifyPluginAsync = async (fastify) => {
    // Register sub-routes
    fastify.register(documentsApiRoutes);
    fastify.register(notebooksApiRoutes);
    fastify.register(alertsApiRoutes);
    fastify.register(documentTypesApiRoutes);
    fastify.register(aiApiRoutes); // AI Chat + RAG
    fastify.register(proactiveApiRoutes); // Proactive Analysis
    fastify.register(departamentosV1Routes); // Departments CRUD

    // Health check
    fastify.get('/health', async (request, reply) => {
        reply.send({ status: 'ok', timestamp: new Date().toISOString() });
    });
};
