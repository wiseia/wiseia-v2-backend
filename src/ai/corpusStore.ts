// src/ai/corpusStore.ts
// Implementação simples de armazenamento local do corpus em JSON (ai_data/ai_corpus.json).

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CorpusData, DocumentRecord, ChunkRecord } from './types.js';

const CORPUS_DIR = path.join(process.cwd(), 'ai_data');
const CORPUS_PATH = path.join(CORPUS_DIR, 'ai_corpus.json');

function createEmptyCorpus(): CorpusData {
  const now = new Date().toISOString();
  return {
    version: 'v1',
    createdAt: now,
    documents: {},
    chunks: {},
    metadata: {
      totalDocs: 0,
      totalChunks: 0,
    },
  };
}

export async function loadCorpus(): Promise<CorpusData> {
  try {
    const txt = await fs.readFile(CORPUS_PATH, 'utf-8');
    const parsed = JSON.parse(txt) as CorpusData;
    // basic sanity: ensure fields exist
    parsed.documents = parsed.documents ?? {};
    parsed.chunks = parsed.chunks ?? {};
    parsed.metadata = parsed.metadata ?? { totalDocs: Object.keys(parsed.documents).length, totalChunks: Object.keys(parsed.chunks).length };
    return parsed;
  } catch (err: any) {
    // se arquivo não existir ou falhar parse, inicializa novo corpus
    const empty = createEmptyCorpus();
    await saveCorpus(empty);
    return empty;
  }
}

export async function saveCorpus(corpus: CorpusData): Promise<void> {
  await fs.mkdir(CORPUS_DIR, { recursive: true });
  const txt = JSON.stringify(corpus, null, 2);
  await fs.writeFile(CORPUS_PATH, txt, 'utf-8');
}

export async function upsertDocumentWithChunks(doc: DocumentRecord, chunks: ChunkRecord[]): Promise<void> {
  const corpus = await loadCorpus();

  // upsert document
  corpus.documents[doc.docId] = doc;

  // upsert chunks
  for (const c of chunks) {
    corpus.chunks[c.chunkId] = c;
  }

  // atualizar contadores
  corpus.metadata.totalDocs = Object.keys(corpus.documents).length;
  corpus.metadata.totalChunks = Object.keys(corpus.chunks).length;

  await saveCorpus(corpus);
}

export async function getAllChunks(): Promise<ChunkRecord[]> {
  const corpus = await loadCorpus();
  return Object.values(corpus.chunks);
}
