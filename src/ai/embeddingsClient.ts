// src/ai/embeddingsClient.ts
// Cliente de embeddings usando OpenAI (text-embedding-3-small por padrão)

import OpenAI from "openai";

const apiKey =
  process.env.OPENAI_API_KEY_V2 || process.env.OPENAI_API_KEY || "";if (apiKey) {
  const prefix = apiKey.slice(0, 8);
  const suffix = apiKey.slice(-4);
  console.log(`[embeddingsClient] Usando chave OpenAI: ${prefix}...${suffix}`);
} else {
  console.warn("[embeddingsClient] Nenhuma API key encontrada!");
}


if (!apiKey) {
  console.warn(
    "[embeddingsClient] Nenhuma OPENAI_API_KEY_V2/OPENAI_API_KEY encontrada. As chamadas de embedding vão falhar."
  );
}

const client = new OpenAI({
  apiKey,
});

const DEFAULT_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small";

/**
 * Gera embeddings para uma lista de textos.
 * Retorna um array de arrays de números (float).
 */
export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts || texts.length === 0) return [];

  // Evita mandar só espaços
  const cleanInputs = texts.map((t) => (t && t.trim() ? t : " "));

  const resp = await client.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL,
    input: cleanInputs,
  });

  return resp.data.map((item) => item.embedding as number[]);
}

/**
 * Gera embedding para uma única consulta (query).
 */
export async function createQueryEmbedding(text: string): Promise<number[]> {
  const [emb] = await createEmbeddings([text]);
  return emb || [];
}
