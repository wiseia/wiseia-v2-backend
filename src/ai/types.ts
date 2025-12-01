// src/ai/types.ts
// Tipos básicos para o protótipo de IA v2 (corpus local em JSON)

export interface DocumentRecord {
  docId: string;
  title?: string | null;
  departmentId?: number | null;
  category?: string | null;
  sourceFilename?: string;
  mime?: string;
  sizeBytes?: number;
  sha256?: string;
  rawText?: string;
  chunks: string[]; // lista de chunkIds
  createdAt: string; // ISO
  metadata?: Record<string, any>;
}

export interface ChunkRecord {
  chunkId: string;
  docId: string;
  index: number;
  text: string;
  embedding: number[] | null; // por enquanto pode ser null
  tokens?: number;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface CorpusData {
  version: string;
  createdAt: string;
  documents: Record<string, DocumentRecord>;
  chunks: Record<string, ChunkRecord>;
  metadata: {
    totalDocs: number;
    totalChunks: number;
  };
}

// Filtros usados na busca RAG (IA v2)
export interface SearchFilters {
  // Empresa dona do documento (no futuro: usado para multi-tenant)
  companyId?: number | null;

  // Departamento (ex: OPERACIONAL, FINANCEIRO, QUALIDADE)
  departmentId?: number | null;

  // Divisão / setor dentro do departamento
  divisionId?: number | null;

  // Tipo de documento (ex: "CONTRATO", "PROPOSTA", "PROCEDIMENTO")
  // Pode vir como string ou id numérico
  category?: string | number | null;

  // Dono do documento (usuário “owner”)
  ownerUserId?: number | null;

  // Filtro por tags: pode ser uma string única ou lista
  // Exemplo: "contrato" ou ["contrato", "agentes"]
  tagsContains?: string | string[] | null;
}

export interface SearchResult {
  chunk: ChunkRecord;
  score: number;
  document: DocumentRecord | null;
}export interface ParsedFile {
  rawText: string;
  mime: string;
  sizeBytes: number;
  sourceFilename: string;
}

