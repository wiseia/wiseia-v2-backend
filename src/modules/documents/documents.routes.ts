// src/modules/documents/documents.routes.ts
import type { FastifyInstance } from 'fastify';
import * as documentsController from './documents.controller.js';

export async function documentsRoutes(app: FastifyInstance) {
  // GET /documents/:id  → detalhes do documento (metadados)
  app.get<{ Params: { id: string } }>(
    '/documents/:id',
    async (request, reply) => {
      // segurança JWT (se o plugin estiver registrado)
      if (typeof (app as any).authenticate === 'function') {
        await (app as any).authenticate(request, reply);
      }

      return documentsController.getDocumentById(request, reply);
    },
  );

  // POST /documents/:id/ocr  → roda OCR no PDF salvo em disco
  app.post<{ Params: { id: string } }>(
    '/documents/:id/ocr',
    async (request, reply) => {
      if (typeof (app as any).authenticate === 'function') {
        await (app as any).authenticate(request, reply);
      }

      return documentsController.runOcr(request, reply);
    },
  );

  // POST /documents/:id/ingest  → gera chunks + embeddings do texto OCR
  app.post<{ Params: { id: string } }>(
    '/documents/:id/ingest',
    async (request, reply) => {
      if (typeof (app as any).authenticate === 'function') {
        await (app as any).authenticate(request, reply);
      }

      return documentsController.ingestDocument(request, reply);
    },
  );
}
