// src/ai/ragService.ts
// Serviço RAG: ingestão, chunking, embeddings, busca semântica e chamada ao LLM.

import crypto from "node:crypto";
import OpenAI from "openai";
import type {
  DocumentRecord,
  ChunkRecord,
  SearchFilters,
  SearchResult,
} from "./types.js";
import { parseBufferToText } from "./fileParser.js";
import * as embeddingsClient from "./embeddingsClient.js";
import * as corpusStore from "./corpusStore.js";

// ---------------------
// Configuração OpenAI
// ---------------------

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY_V2 || process.env.OPENAI_API_KEY || "";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";

// ---------------------
// Chunking
// ---------------------

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];
  if (!text) return chunks;

  let start = 0;
  const clean = text.replace(/\r\n/g, "\n");

  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end === clean.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

// ---------------------
// Header estruturado WISEIA
// ---------------------

function buildWiseiaHeader(meta: {
  title?: string | null;
  departmentId?: number | null;
  category?: string | null;
  tags?: string[] | null;
  companyId?: number | null;
  divisionId?: number | null;
}) {
  return [
    `TITULO: ${meta.title ?? "N/D"}`,
    `EMPRESA_ID: ${meta.companyId ?? "N/D"}`,
    `DEPARTAMENTO_ID: ${meta.departmentId ?? "N/D"}`,
    `DIVISAO_ID: ${meta.divisionId ?? "N/D"}`,
    `TIPO_DOCUMENTO: ${meta.category ?? "N/D"}`,
    `TAGS: ${(meta.tags ?? []).join(", ") || "N/D"}`,
    "====================================================",
  ].join("\n");
}

// ---------------------
// Ingestão
// ---------------------

interface IngestOptions {
  buffer: Buffer;
  filename: string;
  title?: string | null;
  departmentId?: number | null;
  category?: string | null;
  uploadedBy?: number | null;
  companyId?: number | null;
  divisionId?: number | null;
  tags?: string[] | null;
}

export async function ingestBufferAsDocument(options: IngestOptions) {
  const {
    buffer,
    filename,
    title,
    departmentId,
    category,
    uploadedBy,
    companyId,
    divisionId,
    tags,
  } = options;

  const parsed = await parseBufferToText({ buffer, filename });

  const docId = `doc_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const docTitle = title ?? filename ?? null;

  const header = buildWiseiaHeader({
    title: docTitle,
    departmentId,
    category,
    tags: tags ?? [],
    companyId,
    divisionId,
  });

  const fullText = `${header}\n\n${parsed.rawText || ""}`;

  const texts = chunkText(fullText);
  const embeddings =
    texts.length > 0
      ? await embeddingsClient.createEmbeddings(texts)
      : ([] as number[][]);

  const chunks: ChunkRecord[] = texts.map((text, i) => ({
    chunkId: `${docId}_c${i}`,
    docId,
    index: i,
    text,
    embedding: embeddings[i] ?? null,
    tokens: undefined,
    createdAt,
    metadata: {},
  }));

  const metadata = {
    uploadedBy: uploadedBy ?? null,
    companyId: companyId ?? null,
    divisionId: divisionId ?? null,
    ownerUserId: uploadedBy ?? null,
    tags: tags ?? [],
    docType: category ?? null,
  };

  const doc: DocumentRecord = {
    docId,
    title: docTitle,
    departmentId: departmentId ?? null,
    category: category ?? null,
    sourceFilename: filename,
    mime: parsed.mime,
    sizeBytes: parsed.sizeBytes,
    sha256,
    rawText: parsed.rawText,
    chunks: chunks.map((c) => c.chunkId),
    createdAt,
    metadata,
  };

  await corpusStore.upsertDocumentWithChunks(doc, chunks);

  return { docId, chunksCreated: chunks.length };
}

// ---------------------
// Similaridade
// ---------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0,
    normA = 0,
    normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return !normA || !normB ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function scoreBySubstring(chunk: string, query: string): number {
  const q = query.toLowerCase();
  const t = chunk.toLowerCase();

  if (t.includes(q)) return 1;

  const terms = q.split(/\s+/).filter(Boolean);
  let hits = 0;

  for (const term of terms) if (t.includes(term)) hits++;

  return hits === 0 ? 0 : hits / terms.length;
}

// ---------------------
// Busca RAG
// ---------------------

export async function search(
  query: string,
  topK = 5,
  filters?: SearchFilters
): Promise<SearchResult[]> {
  const corpus = await corpusStore.loadCorpus();
  const allChunks = Object.values(corpus.chunks);

  if (!allChunks.length) return [];

  const filtered: Array<{ chunk: ChunkRecord; doc: DocumentRecord }> = [];

  for (const chunk of allChunks) {
    const doc = corpus.documents[chunk.docId];
    if (!doc) continue;
    const meta = doc.metadata ?? {};

    if (filters?.companyId != null && meta.companyId !== filters.companyId)
      continue;
    if (
      filters?.departmentId != null &&
      doc.departmentId !== filters.departmentId
    )
      continue;
    if (filters?.divisionId != null && meta.divisionId !== filters.divisionId)
      continue;
    if (filters?.ownerUserId != null && meta.ownerUserId !== filters.ownerUserId)
      continue;

    if (filters?.category != null) {
      const docType = doc.category ?? meta.docType ?? "";
      if (String(docType) !== String(filters.category)) continue;
    }

    if (filters?.tagsContains) {
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      const needle = String(filters.tagsContains).toLowerCase();
      const hit = tags.some((t: string) =>
        String(t).toLowerCase().includes(needle)
      );
      if (!hit) continue;
    }

    filtered.push({ chunk, doc });
  }

  if (!filtered.length) return [];

  const queryEmbedding = await embeddingsClient.createQueryEmbedding(query);
  const scored: SearchResult[] = [];

  for (const { chunk, doc } of filtered) {
    const semanticScore = chunk.embedding
      ? cosineSimilarity(queryEmbedding, chunk.embedding)
      : 0;

    const lexicalScore = scoreBySubstring(chunk.text, query);
    const finalScore = semanticScore * 0.75 + lexicalScore * 0.25;

    if (finalScore > 0.35) {
      scored.push({ chunk, score: finalScore, document: doc });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ---------------------
// Contexto + LLM
// ---------------------

export function buildContext(
  results: SearchResult[],
  maxChars = 6000
): string {
  const parts: string[] = [];
  let count = 0;

  for (const r of results) {
    const snippet = r.chunk.text.slice(0, 1400);
    const header = `DOC ${r.chunk.docId} (score=${r.score.toFixed(3)}):`;
    const block = `${header}\n${snippet}\n---`;

    if (count + block.length > maxChars) break;

    parts.push(block);
    count += block.length;
  }

  return parts.join("\n");
}

export async function answerWithLLM(
  question: string,
  results: SearchResult[]
): Promise<{ answer: string; context: string }> {
  const context = buildContext(results);

  const prompt = `
Você é um assistente especialista em leitura de documentos empresariais.

Extraia SEMPRE:
• Quem é a empresa contratante
• Quem é a empresa contratada
• Quem representa legalmente as empresas (se aparecer)
• Nome da pessoa física se houver "representado por", "infra-assinado" ou similar.

Se houver uma pessoa física representando uma empresa:
→ RESPONDA o nome dela explicitamente.

Não responda com suposições.
Use SOMENTE o que está no texto.
------------------------------------

CONTEXTO:
${context}

------------------------------------
Pergunta:
${question}
nça".

---------------- CONTEXTO ----------------
${context}
--------------- FIM CONTEXTO -------------

Pergunta:
${question}
`.trim();

  const resp = await openai.responses.create({
    model: CHAT_MODEL,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
  });

  const answer = (resp as any).output_text ?? "";

  return { answer, context };
}
