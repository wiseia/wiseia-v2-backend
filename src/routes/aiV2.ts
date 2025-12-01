// src/routes/aiV2.ts
// Plugin Fastify: porta de entrada HTTP para a IA v2 (RAG).

import { FastifyInstance } from "fastify";
import * as ragService from "../ai/ragService.js";
import { askAiCore } from "../ai/aiCoreClient.js";

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

// Função auxiliar para localizar campos de arquivo em req.body (multipart)
function findFilesInBody(body: any) {
  if (!body || typeof body !== "object") return [];
  const list: any[] = [];

  for (const [, v] of Object.entries(body)) {
    if (!v) continue;

    // Caso seja um único arquivo (objeto com .file ou .toBuffer)
    if (
      typeof v === "object" &&
      (("file" in (v as any)) || typeof (v as any).toBuffer === "function")
    ) {
      list.push(v);
    }

    // Caso seja um array de arquivos
    if (Array.isArray(v)) {
      for (const el of v) {
        if (
          el &&
          typeof el === "object" &&
          (("file" in el) || typeof (el as any).toBuffer === "function")
        ) {
          list.push(el);
        }
      }
    }
  }

  return list;
}

// Lê valor de campo multipart (suporta string pura ou { value })
function getMultipartField(body: any, fieldName: string): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as any)[fieldName];
  if (v == null) return undefined;

  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);

  if (typeof v === "object" && "value" in v) {
    const inner = (v as any).value;
    if (inner == null) return undefined;
    return String(inner);
  }

  try {
    return String(v);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------
// Rotas
// ---------------------------------------------------------

export default async function aiV2Routes(app: FastifyInstance) {
  const skipAuth = String(process.env.SKIP_DB ?? "") === "1";

  if (skipAuth) {
    app.log.warn(
      "AI v2 routes running WITHOUT auth because SKIP_DB=1 (dev mode)."
    );
  } else {
    app.log.info("AI v2 routes running WITH auth.");
  }

  const authOpts = skipAuth ? {} : { preHandler: (app as any).authenticate };

  // -------------------------------------------------------
  // POST /ai/v2/ingest  -> ingestão de arquivos no corpus JSON (back-end antigo)
  // -------------------------------------------------------
  app.post(
    "/ai/v2/ingest",
    authOpts,
    async (req: any, reply) => {
      // requer multipart/form-data (attachFieldsToBody = true configurado no servidor)
      if (!req.isMultipart || !req.isMultipart()) {
        return reply
          .code(415)
          .send({ ok: false, error: "Content-Type deve ser multipart/form-data" });
      }

      const body = req.body ?? {};
      const files = findFilesInBody(body);

      if (files.length === 0) {
        return reply
          .code(400)
          .send({ ok: false, error: "Nenhum arquivo enviado" });
      }

      // Metadados opcionais enviados junto com o upload
      const companyIdRaw = getMultipartField(body, "companyId");
      const departmentIdRaw = getMultipartField(body, "departmentId");
      const divisionIdRaw = getMultipartField(body, "divisionId");
      const categoryRaw = getMultipartField(body, "category");   // tipo de documento
      const docTypeRaw = getMultipartField(body, "docType");     // alias para category
      const tagsRaw = getMultipartField(body, "tags");           // ex: "contrato, transporte"

      // No futuro: se tiver auth real, podemos usar req.user.id
      const uploadedByUserId =
        !skipAuth && (req as any).user && (req as any).user.id
          ? Number((req as any).user.id)
          : undefined;

      const departmentId =
        departmentIdRaw != null && departmentIdRaw !== ""
          ? Number(departmentIdRaw)
          : undefined;

      const divisionId =
        divisionIdRaw != null && divisionIdRaw !== ""
          ? Number(divisionIdRaw)
          : undefined;

      // category/docType: usamos como "tipo de documento"
      const category =
        (categoryRaw && categoryRaw.trim()) ||
        (docTypeRaw && docTypeRaw.trim()) ||
        undefined;

      const tags =
        tagsRaw && tagsRaw.trim().length > 0
          ? tagsRaw
          : undefined;

      const results: Array<{
        filename: string;
        docId?: string;
        chunksCreated?: number;
        error?: string;
      }> = [];

      for (const f of files) {
        try {
          let buf: Buffer | null = null;

          if (typeof (f as any).toBuffer === "function") {
            buf = await (f as any).toBuffer();
          } else if ((f as any).file) {
            // fallback: stream -> buffer
            buf = await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              (f as any).file.on("data", (chunk: Buffer) => chunks.push(chunk));
              (f as any).file.on("end", () => resolve(Buffer.concat(chunks)));
              (f as any).file.on("error", reject);
            });
          }

          if (!buf) throw new Error("arquivo inválido");

          const filename = String((f as any).filename || "file");

          // Chama o serviço de ingestão com metadados básicos (back-end antigo)
          const ingestRes = await (ragService as any).ingestBufferAsDocument({
            buffer: buf,
            filename,
            title: filename,
            departmentId: departmentId ?? null,
            category: category ?? null,
            uploadedBy: uploadedByUserId ?? null,
            // companyIdRaw, divisionId, tags disponíveis para evoluir tipos depois
          });

          results.push({
            filename,
            docId: ingestRes.docId,
            chunksCreated: ingestRes.chunksCreated,
          });
        } catch (err: any) {
          results.push({
            filename: String((f as any)?.filename ?? "file"),
            error: String(err?.message ?? err),
          });
        }
      }

      return reply.send({ ok: true, results });
    }
  );

  // -------------------------------------------------------
  // POST /ai/v2/chat  -> agora chama o WISEIA IA Core (microserviço)
  // -------------------------------------------------------
  app.post(
    "/ai/v2/chat",
    authOpts,
    async (req: any, reply) => {
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const rawQuestion = (body as any).question ?? (body as any).q;
      const question =
        typeof rawQuestion === "string" ? rawQuestion.trim() : "";

      // topK vindo do cliente (por enquanto só pra log/retorno)
      const requestedTopK = Number((body as any).topK);
      const topK =
        Number.isFinite(requestedTopK) &&
        requestedTopK > 0 &&
        requestedTopK <= 20
          ? requestedTopK
          : 10; // default 10

      if (!question) {
        return reply
          .code(400)
          .send({ ok: false, error: "question é obrigatório" });
      }

      const startedAt = Date.now();

      try {
        // ---------------------------------------------------
        // Montagem de filtros de busca (SearchFilters -> scope)
        // ---------------------------------------------------
        let filters: any =
          body.filters && typeof body.filters === "object"
            ? { ...(body.filters as any) }
            : {};

        // Se tiver autenticação, podemos restringir por empresa/departamento/usuário
        if (!skipAuth && (req as any).user) {
          const user = (req as any).user;

          if (user.companyId != null && filters.companyId == null) {
            filters.companyId = user.companyId;
          }

          const role = String(user.role || "").toUpperCase();

          if (role === "MANAGER" || role === "COORDINATOR" || role === "USER") {
            if (user.departmentId != null && filters.departmentId == null) {
              filters.departmentId = user.departmentId;
            }
          }

          if (role === "COORDINATOR" || role === "USER") {
            if (user.divisionId != null && filters.divisionId == null) {
              filters.divisionId = user.divisionId;
            }
          }

          if (role === "USER" && user.id != null && filters.ownerUserId == null) {
            filters.ownerUserId = user.id;
          }
        }

        // Monta o escopo que será enviado ao IA Core
        const scope = {
          companyId: Number(filters.companyId ?? 1),
          department:
            filters.department ??
            (filters.departmentId != null
              ? String(filters.departmentId)
              : undefined),
          division:
            filters.division ??
            (filters.divisionId != null
              ? String(filters.divisionId)
              : undefined),
          ownerUserId:
            filters.ownerUserId != null
              ? Number(filters.ownerUserId)
              : undefined,
          documentType:
            filters.category != null
              ? String(filters.category)
              : undefined,
          tags: Array.isArray(filters.tags) ? filters.tags : undefined,
        };

        // ---------------------------------------------------
        // Chama o microserviço WISEIA IA Core
        // ---------------------------------------------------
        const aiResp = await askAiCore(question, scope);

        const elapsedMs = Date.now() - startedAt;

        return reply.send({
          ok: true,
          question,
          topK,
          answer: aiResp.answer,
          topChunks: aiResp.topChunks,
          elapsedMs,
        });
      } catch (err: any) {
        req.log?.error?.({ err }, "Erro em /ai/v2/chat");
        return reply
          .code(500)
          .send({ ok: false, error: "Erro interno na IA v2." });
      }
    }
  );
}
