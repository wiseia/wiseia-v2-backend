// src/modules/documents/documents.embeddings.service.ts
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn('[EMBEDDINGS] OPENAI_API_KEY não configurada. Ingestão IA vai falhar.');
}

const openai = new OpenAI({ apiKey });

export async function embedText(text: string): Promise<number[]> {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada para embeddings');
  }

  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

  const response = await openai.embeddings.create({
    model,
    input: text,
  });

  const [first] = response.data;
  if (!first || !first.embedding) {
    throw new Error('Resposta de embedding vazia da OpenAI');
  }

  return first.embedding;
}
