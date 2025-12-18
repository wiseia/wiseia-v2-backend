// src/modules/documents/documents.ingest.service.ts
import {
  getDocumentOcrText,
  deleteChunksAndEmbeddingsForDocument,
  insertChunk,
  insertChunkEmbedding,
} from './documents.repository.js';
import { embedText } from './documents.embeddings.service.js';

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
}

// 🔹 Estratégia simples de chunking por caracteres com overlap
function createChunks(
  text: string,
  chunkSize = 1200,
  overlap = 200,
): string[] {
  const clean = normalizeText(text);
  const chunks: string[] = [];

  let start = 0;
  const len = clean.length;

  while (start < len) {
    const end = Math.min(len, start + chunkSize);
    const slice = clean.slice(start, end).trim();
    if (slice) {
      chunks.push(slice);
    }
    if (end === len) break;
    start = end - overlap; // overlap
  }

  return chunks;
}

export interface IngestionResult {
  documentId: number;
  totalChunks: number;
  totalEmbeddings: number;
  model: string;
}

export async function ingestDocumentById(documentId: number): Promise<IngestionResult> {
  // 1) Busca o texto OCR
  const text = await getDocumentOcrText(documentId);

  if (!text || !text.trim()) {
    throw new Error('Documento ainda não possui texto OCR em DocumentText. Rode /documents/:id/ocr antes.');
  }

  // 2) Cria chunks
  const chunks = createChunks(text);
  if (!chunks.length) {
    throw new Error('Texto OCR vazio após chunking');
  }

  // 3) Remove chunks/embeddings antigos
  await deleteChunksAndEmbeddingsForDocument(documentId);

  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  let totalEmbeddings = 0;

  // 4) Para cada chunk: salva + gera embedding
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];

    const chunkId = await insertChunk(documentId, i, chunkText);

    const embedding = await embedText(chunkText);
    await insertChunkEmbedding(chunkId, embedding, 'openai', model);
    totalEmbeddings++;
  }

  return {
    documentId,
    totalChunks: chunks.length,
    totalEmbeddings,
    model,
  };
}
