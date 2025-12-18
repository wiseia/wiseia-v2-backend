import { getPool, sql } from '../db.js';
import { openai, OPENAI_MODEL } from '../lib/openaiClient.js';

// ==================== TIPOS ====================

export interface RagScope {
  companyId: string;
  department?: string;
  division?: string;
  documentType?: string;
  documentIds?: string[]; // Específicos documentos
  tags?: string[];
  ownerUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  metadata: {
    companyId: string;
    department?: string;
    documentType?: string;
    tags?: string[];
    createdAt: Date;
  };
}

export interface RagResult {
  answer: string;
  sources: ChunkSource[];
  confidence: number;
  tokensUsed: number;
}

export interface ChunkSource {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  score: number;
  text: string;
  metadata: any;
}

// ==================== CACHE ====================

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

const embeddingCache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

function getCachedEmbedding(text: string): number[] | null {
  const cached = embeddingCache.get(text);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.embedding;
  }
  embeddingCache.delete(text);
  return null;
}

function cacheEmbedding(text: string, embedding: number[]): void {
  embeddingCache.set(text, {
    embedding,
    timestamp: Date.now()
  });
}

// ==================== SIMILARIDADE ====================

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ==================== BUSCA DE CHUNKS ====================

async function getChunksFromDatabase(scope: RagScope): Promise<DocumentChunk[]> {
  const pool = await getPool();
  const request = pool.request();

  let whereConditions: string[] = [];
  let params: any[] = [];

  // SEMPRE filtrar por empresa
  whereConditions.push('d.CompanyID = @companyId');
  request.input('companyId', sql.UniqueIdentifier, scope.companyId);

  // Filtros opcionais
  if (scope.documentIds && scope.documentIds.length > 0) {
    const ids = scope.documentIds.map((id, idx) => {
      request.input(`docId${idx}`, sql.UniqueIdentifier, id);
      return `@docId${idx}`;
    }).join(',');
    whereConditions.push(`d.DocumentID IN (${ids})`);
  }

  if (scope.department) {
    whereConditions.push('d.Department = @department');
    request.input('department', sql.NVarChar(100), scope.department);
  }

  if (scope.documentType) {
    whereConditions.push('dt.Name = @documentType');
    request.input('documentType', sql.NVarChar(100), scope.documentType);
  }

  if (scope.dateFrom) {
    whereConditions.push('d.CreatedAt >= @dateFrom');
    request.input('dateFrom', sql.DateTime, scope.dateFrom);
  }

  if (scope.dateTo) {
    whereConditions.push('d.CreatedAt <= @dateTo');
    request.input('dateTo', sql.DateTime, scope.dateTo);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const result = await request.query(`
    SELECT 
      c.ChunkID as chunkId,
      c.DocumentID as documentId,
      d.Title as documentTitle,
      c.ChunkIndex as chunkIndex,
      c.ChunkText as text,
      e.Embedding as embedding,
      d.CompanyID as companyId,
      d.Department as department,
      dt.Name as documentType,
      d.Tags as tags,
      d.CreatedAt as createdAt
    FROM DocumentChunks c
    INNER JOIN Documents d ON c.DocumentID = d.DocumentID
    LEFT JOIN DocumentTypes dt ON d.TypeID = dt.TypeID
    INNER JOIN ChunkEmbeddings e ON c.ChunkID = e.ChunkID
    ${whereClause}
      AND d.Active = 1
    ORDER BY d.CreatedAt DESC
  `);

  return result.recordset.map((row: any) => ({
    chunkId: row.chunkId,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    chunkIndex: row.chunkIndex,
    text: row.text,
    embedding: JSON.parse(row.embedding), // Stored as JSON string
    metadata: {
      companyId: row.companyId,
      department: row.department,
      documentType: row.documentType,
      tags: row.tags ? JSON.parse(row.tags) : [],
      createdAt: row.createdAt
    }
  }));
}

// ==================== GERAÇÃO DE EMBEDDING ====================

async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache first
  const cached = getCachedEmbedding(text);
  if (cached) {
    console.log('[RAG] Using cached embedding');
    return cached;
  }

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: [text]
  });

  const embedding = response.data[0].embedding;
  cacheEmbedding(text, embedding);

  return embedding;
}

// ==================== FUNÇÃO PRINCIPAL RAG ====================

export async function askWithRag(
  question: string,
  scope: RagScope,
  options: {
    topK?: number;
    temperature?: number;
    includeContext?: boolean;
  } = {}
): Promise<RagResult> {
  const {
    topK = 5,
    temperature = 0.2,
    includeContext = true
  } = options;

  if (!question || !question.trim()) {
    throw new Error('Pergunta vazia');
  }

  console.log(`[RAG] Pergunta: "${question}"`);
  console.log(`[RAG] Scope: ${JSON.stringify(scope)}`);

  // 1. Buscar chunks do banco de dados
  const startFetch = Date.now();
  const chunks = await getChunksFromDatabase(scope);
  console.log(`[RAG] Encontrados ${chunks.length} chunks em ${Date.now() - startFetch}ms`);

  if (chunks.length === 0) {
    return {
      answer: 'Não encontrei documentos disponíveis com os filtros aplicados. Verifique se há documentos processados para sua empresa/departamento.',
      sources: [],
      confidence: 0,
      tokensUsed: 0
    };
  }

  // 2. Gerar embedding da pergunta
  const startEmbed = Date.now();
  const questionEmbedding = await generateEmbedding(question);
  console.log(`[RAG] Embedding gerado em ${Date.now() - startEmbed}ms`);

  // 3. Calcular similaridade com todos os chunks
  const startSimilarity = Date.now();
  const scoredChunks = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(questionEmbedding, chunk.embedding)
  }));
  console.log(`[RAG] Similaridade calculada em ${Date.now() - startSimilarity}ms`);

  // 4. Ordenar por score e pegar top K
  const topChunks = scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  console.log('[RAG] Top chunks:');
  topChunks.forEach((chunk, idx) => {
    console.log(`  ${idx + 1}. [${chunk.documentTitle}] score=${chunk.score.toFixed(3)}`);
  });

  // Calcular confiança média
  const avgScore = topChunks.reduce((sum, c) => sum + c.score, 0) / topChunks.length;
  const confidence = Math.min(avgScore * 100, 100);

  // 5. Montar contexto para o GPT
  const contextText = topChunks
    .map((chunk, idx) =>
      `[Trecho ${idx + 1} - Documento: "${chunk.documentTitle}" | Departamento: ${chunk.metadata.department || 'N/A'}]\n${chunk.text}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `
Você é a IA assistente do WISEIA, um sistema avançado de gestão de documentos corporativos.

Seu objetivo é responder perguntas com base EXCLUSIVAMENTE nos trechos de documentos fornecidos.

Regras importantes:
1. Responda SEMPRE em português, de forma clara e profissional
2. Use APENAS informações dos trechos fornecidos
3. Se não houver informação suficiente, diga claramente
4. Cite o documento de origem quando relevante (ex: "Segundo o documento X...")
5. Seja objetivo e conciso, mas completo
6. Se houver contradições entre documentos, mencione
7. Organize a resposta em tópicos quando apropriado
`.trim();

  const userPrompt = includeContext
    ? `
===== CONTEXTO (Trechos de Documentos) =====

${contextText}

===== PERGUNTA =====

${question}

===== INSTRUÇÕES =====

Com base APENAS nos trechos acima, responda a pergunta de forma completa e profissional.
`.trim()
    : question;

  // 6. Chamar GPT para gerar resposta
  const startGPT = Date.now();
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature,
    max_tokens: 1000
  });
  console.log(`[RAG] GPT respondeu em ${Date.now() - startGPT}ms`);

  const answer = completion.choices[0]?.message?.content ?? 'Não foi possível gerar uma resposta.';
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  return {
    answer,
    sources: topChunks.map(chunk => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      score: chunk.score,
      text: chunk.text.substring(0, 200) + '...', // Preview
      metadata: chunk.metadata
    })),
    confidence,
    tokensUsed
  };
}

// ==================== ANÁLISE MULTI-DOCUMENTOS ====================

export async function analyzeMultipleDocuments(
  documentIds: string[],
  question: string,
  companyId: string
): Promise<RagResult> {
  console.log(`[RAG] Análise multi-doc: ${documentIds.length} documentos`);

  return await askWithRag(question, {
    companyId,
    documentIds
  }, {
    topK: documentIds.length * 3, // Mais chunks para análise comparativa
    temperature: 0.3
  });
}

// ==================== BUSCA SEMÂNTICA ====================

export async function semanticSearch(
  query: string,
  scope: RagScope,
  limit: number = 10
): Promise<ChunkSource[]> {
  const chunks = await getChunksFromDatabase(scope);

  if (chunks.length === 0) {
    return [];
  }

  const queryEmbedding = await generateEmbedding(query);

  const scoredChunks = chunks.map(chunk => ({
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
    text: chunk.text,
    metadata: chunk.metadata
  }));

  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
