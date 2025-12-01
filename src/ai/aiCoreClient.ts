// src/ai/aiCoreClient.ts

export interface AiCoreScope {
  companyId: number;
  department?: string;
  division?: string;
  ownerUserId?: number;
  documentType?: string;
  tags?: string[];
}

export interface AiCoreTopChunk {
  id: string;
  documentName: string;
  metadata: any;
  score: number;
}

export interface AiCoreResponse {
  answer: string;
  topChunks: AiCoreTopChunk[];
}

// Função que chama o serviço wiseia-ia-core em http://localhost:4000/chat
export async function askAiCore(
  question: string,
  scope: AiCoreScope
): Promise<AiCoreResponse> {
  const res = await fetch("http://localhost:4000/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question,
      scope
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Erro ao chamar IA Core: ${res.status} - ${text}`
    );
  }

  const json = (await res.json()) as AiCoreResponse;
  return json;
}
