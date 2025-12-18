// src/modules/documents/documents.controller.ts
import { getDocumentByIdService, ingestDocumentService } from './documents.service.js';
import { DecodedToken } from '../../types/DecodedToken.js';
import { runOcrForDocument } from './documents.ocr.service.js';

// GET /documents/:id  -> detalhes do documento com checagem de permissão
export async function getDocumentById(request: any, reply: any) {
  try {
    const documentId = Number(request.params.id);

    // aqui PODEMOS usar o usuário, porque essa rota já estava funcionando
    const user = request.user as DecodedToken | undefined;

    if (!user) {
      return reply.status(401).send({ error: 'Token inválido' });
    }

    const document = await getDocumentByIdService(documentId, user);

    if (!document) {
      return reply.status(403).send({ error: 'Acesso negado ao documento' });
    }

    return reply.send(document);
  } catch (err: any) {
    request.log.error({ err }, '[DOC] erro ao buscar documento');
    return reply.status(500).send({
      error: 'Falha ao buscar documento',
      details: err?.message ?? 'Erro interno',
    });
  }
}

// POST /documents/:id/ocr  -> roda OCR no PDF
export async function runOcr(request: any, reply: any) {
  try {
    const { id } = request.params;
    const documentId = Number(id);

    if (!documentId || Number.isNaN(documentId)) {
      return reply.status(400).send({ error: 'DocumentId inválido' });
    }

    const text = await runOcrForDocument(documentId);

    return reply.send({
      success: true,
      documentId,
      ocrTextLength: text.length,
    });
  } catch (err: any) {
    request.log.error({ err }, '[DOC OCR] erro ao executar OCR');
    return reply.status(500).send({
      error: 'Falha ao executar OCR',
      details: err?.message ?? 'Erro interno',
    });
  }
}

// POST /documents/:id/ingest  -> cria chunks + embeddings (AINDA sem permissão de usuário)
export async function ingestDocument(request: any, reply: any) {
  try {
    const { id } = request.params;
    const documentId = Number(id);

    if (!documentId || Number.isNaN(documentId)) {
      return reply.status(400).send({ error: 'DocumentId inválido' });
    }

    // ⚠️ POR ENQUANTO SEM CHECAR request.user AQUI
    // depois a gente volta e adiciona permissão bonitinho

    const result = await ingestDocumentService(documentId);

    return reply.send({
      success: true,
      documentId,
      chunksCreated: result.chunksCreated,
      embeddingsCreated: result.embeddingsCreated,
    });
  } catch (err: any) {
    request.log.error({ err }, '[DOC INGEST] erro ao ingerir documento');
    return reply.status(500).send({
      error: 'Falha ao ingerir documento',
      details: err?.message ?? 'Erro interno',
    });
  }
}
