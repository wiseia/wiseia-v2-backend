// src/routes/documentDownloadRoutes.ts
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import path from "node:path";
import { getPool, sql } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const STORAGE_ROOT = process.env.FILE_STORAGE_ROOT
  ? path.resolve(process.env.FILE_STORAGE_ROOT)
  : path.resolve(process.cwd(), "storage");

interface DecodedToken {
  sub: number;
  email: string;
  role: string;
  companyId: number | null;
  departmentId: number | null;
  divisionId: number | null;
}

function decodeUser(request: any): DecodedToken {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Token não informado");
  }

  const token = auth.replace("Bearer ", "").trim();
  return jwt.verify(token, JWT_SECRET) as any;
}

export async function documentDownloadRoutes(app: FastifyInstance) {
  /**
   * GET /documents/:id/download
   */
  app.get("/documents/:id/download", async (request: any, reply: any) => {
    try {
      const user = decodeUser(request);
      const documentId = parseInt(request.params.id, 10);

      if (isNaN(documentId)) {
        return reply.status(400).send({ error: "DocumentId inválido" });
      }

      if (user.role === "SUPER_ADMIN") {
        return reply.status(403).send({
          error: "SUPER_ADMIN não pode baixar documentos por política de segurança.",
        });
      }

      if (!user.companyId) {
        return reply.status(400).send({
          error: "Usuário sem empresa vinculada.",
        });
      }

      const pool = await getPool();

      // 1 — Buscar metadados do documento
      const docQuery = await pool
        .request()
        .input("DocumentId", sql.Int, documentId)
        .input("CompanyId", sql.Int, user.companyId)
        .query(`
          SELECT 
            d.DocumentId,
            d.CompanyId,
            d.DepartmentId,
            d.DivisionId,
            d.OwnerUserId,
            d.Title,
            d.Tags,
            d.StorageType,
            d.StoragePath,
            d.MimeType,
            d.FileSizeBytes
          FROM Documents d
          WHERE d.DocumentId = @DocumentId
            AND d.CompanyId = @CompanyId
            AND d.IsActive = 1;
        `);

      if (docQuery.recordset.length === 0) {
        return reply.status(404).send({ error: "Documento não encontrado." });
      }

      const doc = docQuery.recordset[0];

      // 2 — Checar permissão
      const hasPermission = await checkPermission(pool, user, doc);

      if (!hasPermission) {
        return reply.status(403).send({ error: "Acesso negado ao documento." });
      }

      // 3 — Retornar conteúdo conforme StorageType
      if (doc.StorageType === "INLINE_TEXT" || !doc.StorageType) {
        const textQuery = await pool
          .request()
          .input("DocumentId", sql.Int, documentId)
          .query(`
            SELECT Content
            FROM DocumentText
            WHERE DocumentId = @DocumentId;
          `);

        const content =
          textQuery.recordset[0]?.Content ?? "Documento sem conteúdo.";

        reply.header("Content-Type", "text/plain; charset=utf-8");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${(doc.Tags || "documento")}.txt"`
        );

        return reply.send(content);
      }

      if (doc.StorageType === "UPLOAD") {
        if (!doc.StoragePath) {
          return reply.status(500).send({
            error:
              "Documento com StorageType=UPLOAD mas sem StoragePath definido.",
          });
        }

        const fullPath = path.join(STORAGE_ROOT, doc.StoragePath);

        let fileBuffer: Buffer;
        try {
          fileBuffer = await fs.readFile(fullPath);
        } catch (e: any) {
          app.log.error(
            { err: e, fullPath },
            "[DOCS] Erro ao ler arquivo físico para download"
          );
          return reply.status(500).send({
            error: "Falha ao ler arquivo do disco.",
            details: e.message,
          });
        }

        const fileName = path.basename(doc.StoragePath);
        const mime =
          doc.MimeType && typeof doc.MimeType === "string"
            ? doc.MimeType
            : "application/octet-stream";

        reply.header("Content-Type", mime);
        reply.header(
          "Content-Disposition",
          `attachment; filename="${fileName}"`
        );

        return reply.send(fileBuffer);
      }

      // Tipo de armazenamento desconhecido
      return reply.status(501).send({
        error:
          "Tipo de armazenamento não suportado para download no momento.",
      });
    } catch (err: any) {
      app.log.error(err);
      return reply.status(500).send({
        error: "Falha ao baixar documento",
        details: err.message,
      });
    }
  });
}

/**
 * Função auxiliar de permissão
 */
async function checkPermission(pool: any, user: DecodedToken, doc: any) {
  const userId = user.sub;

  if (user.role === "MASTER") return true;

  if (user.role === "MANAGER") {
    return doc.DepartmentId === user.departmentId;
  }

  if (user.role === "COORDINATOR") {
    return (
      doc.DepartmentId === user.departmentId &&
      (doc.DivisionId === user.divisionId || doc.OwnerUserId === userId)
    );
  }

  if (user.role === "USER") {
    if (doc.OwnerUserId === userId) return true;
  }

  const accessQuery = await pool
    .request()
    .input("DocumentId", sql.Int, doc.DocumentId)
    .input("CompanyId", sql.Int, user.companyId)
    .input("UserId", sql.Int, userId)
    .input("DepartmentId", sql.Int, user.departmentId ?? null)
    .input("DivisionId", sql.Int, user.divisionId ?? null)
    .query(`
      SELECT TOP 1 *
      FROM DocumentAccess
      WHERE DocumentId = @DocumentId
        AND CompanyId = @CompanyId
        AND (
          AllowedUserId = @UserId
          OR (@DepartmentId IS NOT NULL AND AllowedDepartmentId = @DepartmentId)
          OR (@DivisionId IS NOT NULL AND AllowedDivisionId = @DivisionId)
        );
    `);

  return accessQuery.recordset.length > 0;
}
