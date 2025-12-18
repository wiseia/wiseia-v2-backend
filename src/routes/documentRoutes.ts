// src/routes/documentRoutes.ts
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import fastifyMultipart from "@fastify/multipart";
import axios from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { getPool, sql } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// raiz do storage local de arquivos (PDF, Excel, imagens, etc.)
const STORAGE_ROOT = process.env.FILE_STORAGE_ROOT
  ? path.resolve(process.env.FILE_STORAGE_ROOT)
  : path.resolve(process.cwd(), "storage");

type RoleCode =
  | "SUPER_ADMIN"
  | "MASTER"
  | "MANAGER"
  | "COORDINATOR"
  | "USER"
  | string;

interface DecodedToken {
  sub: number;
  email: string;
  role: RoleCode;
  companyId: number | null;
  departmentId: number | null;
  divisionId: number | null;
}

function decodeUser(request: any): DecodedToken {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    throw new Error("Token não informado");
  }
  const token = auth.replace("Bearer ", "").trim();
  const raw = jwt.verify(token, JWT_SECRET) as any;

  const roleNorm = String(raw.role || "")
    .replace(/\s+/g, "_")
    .toUpperCase() as RoleCode;

  return {
    sub: raw.sub,
    email: raw.email,
    role: roleNorm,
    companyId: raw.companyId ?? null,
    departmentId: raw.departmentId ?? null,
    divisionId: raw.divisionId ?? null,
  };
}

export async function documentRoutes(app: FastifyInstance) {
  // habilita multipart para upload de arquivos
  app.register(fastifyMultipart);

  /**
   * POST /documents/upload
   *
   * - Se multipart: upload de arquivo real (PDF, Excel, imagem, etc.)
   *   -> arquivo salvo em disco, StorageType = 'UPLOAD'
   * - Se JSON com { text }: documento textual
   *   -> salvo em DocumentText, StorageType = 'INLINE_TEXT'
   */
  app.post("/documents/upload", async (request: any, reply: any) => {
    try {
      const user = decodeUser(request);

      if (!user.companyId) {
        return reply
          .status(400)
          .send({ error: "Usuário sem empresa vinculada" });
      }

      const pool = await getPool();

      let fileBuffer: Buffer | null = null;
      let fileName: string | null = null;
      let mimeType: string | null = null;
      let textContent: string | null = null;

      const isMultipart =
        typeof request.isMultipart === "function" && request.isMultipart();

      if (isMultipart) {
        // 📁 Upload real de arquivo (PDF, Excel, imagem, etc.)
        const data = await request.file();
        if (!data) {
          return reply
            .status(400)
            .send({ error: "Nenhum arquivo enviado no multipart" });
        }
        fileName = data.filename;
        mimeType = data.mimetype || "application/octet-stream";
        fileBuffer = await data.toBuffer();
      } else {
        // 📝 Upload de texto simples via JSON
        const body = request.body as { text?: string } | undefined;
        textContent = body?.text || null;

        if (!textContent) {
          return reply.status(400).send({
            error:
              "Envie um arquivo (multipart/form-data) ou um campo 'text' no JSON",
          });
        }

        fileName = "conteudo.txt";
        mimeType = "text/plain";
        fileBuffer = Buffer.from(textContent, "utf-8");
      }

      if (!fileBuffer || !fileName || !mimeType) {
        return reply
          .status(500)
          .send({ error: "Falha ao processar conteúdo do documento" });
      }

      // título amigável
      let title = fileName;
      if (!title || title === "conteudo.txt") {
        const preview = textContent ?? fileBuffer.toString("utf-8");
        title =
          preview.length > 80 ? preview.substring(0, 77) + "..." : preview;
      }

      // tags básicas = nome do arquivo sem extensão
      const dotIndex = fileName.lastIndexOf(".");
      const baseName =
        dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
      const tags = baseName;

      const isFileUpload = isMultipart; // true = arquivo real, false = texto
      const storageType = isFileUpload ? "UPLOAD" : "INLINE_TEXT";
      let storagePath = isFileUpload ? "" : "INLINE_TEXT";

      const version = 1;
      const isActive = 1;

      // 1️⃣ Insere metadados em Documents
      const insertResult = await pool
        .request()
        .input("CompanyId", sql.Int, user.companyId)
        .input("DepartmentId", sql.Int, user.departmentId)
        .input("DivisionId", sql.Int, user.divisionId)
        .input("OwnerUserId", sql.Int, user.sub)
        .input("Title", sql.NVarChar, title)
        .input("Description", sql.NVarChar, null)
        .input("Category", sql.NVarChar, null)
        .input("Tags", sql.NVarChar, tags)
        .input("StorageType", sql.NVarChar, storageType)
        .input("StoragePath", sql.NVarChar, storagePath)
        .input("MimeType", sql.NVarChar, mimeType)
        .input("FileSizeBytes", sql.BigInt, fileBuffer.length)
        .input("Version", sql.Int, version)
        .input("IsActive", sql.Bit, isActive)
        .input("CreatedByUserId", sql.Int, user.sub)
        .query(`
          INSERT INTO Documents (
            CompanyId,
            DepartmentId,
            DivisionId,
            OwnerUserId,
            Title,
            Description,
            Category,
            Tags,
            StorageType,
            StoragePath,
            MimeType,
            FileSizeBytes,
            Version,
            IsActive,
            CreatedByUserId,
            CreatedAt,
            UpdatedAt
          )
          OUTPUT INSERTED.DocumentId AS DocumentId
          VALUES (
            @CompanyId,
            @DepartmentId,
            @DivisionId,
            @OwnerUserId,
            @Title,
            @Description,
            @Category,
            @Tags,
            @StorageType,
            @StoragePath,
            @MimeType,
            @FileSizeBytes,
            @Version,
            @IsActive,
            @CreatedByUserId,
            SYSDATETIME(),
            SYSDATETIME()
          );
        `);

      const documentId: number = insertResult.recordset[0]?.DocumentId ?? 0;

      // 2️⃣ Resolve nomes de empresa/departamento/divisão
      const orgResult = await pool
        .request()
        .input("CompanyId", sql.Int, user.companyId)
        .input("DepartmentId", sql.Int, user.departmentId ?? null)
        .input("DivisionId", sql.Int, user.divisionId ?? null)
        .query(`
          SELECT
            c.Name AS CompanyName,
            d.Name AS DepartmentName,
            v.Name AS DivisionName
          FROM Companies c
          LEFT JOIN Departments d
            ON d.CompanyId = c.CompanyId
           AND d.DepartmentId = @DepartmentId
          LEFT JOIN Divisions v
            ON v.CompanyId = c.CompanyId
           AND v.DivisionId = @DivisionId
          WHERE c.CompanyId = @CompanyId;
        `);

      const orgInfo = orgResult.recordset[0] || {};
      const companyName: string = orgInfo.CompanyName || "";
      const departmentName: string = orgInfo.DepartmentName || "";
      const divisionName: string = orgInfo.DivisionName || "";

      // 3️⃣ Texto para IA + DocumentText SÓ para documentos textuais
      let ingestStatus: "ok" | "skipped" | "failed" = "skipped";

      if (!isFileUpload) {
        const headerLines = [
          `EMPRESA_ID: ${user.companyId}`,
          `EMPRESA_NOME: ${companyName}`,
          `DEPARTAMENTO_ID: ${user.departmentId ?? ""}`,
          `DEPARTAMENTO_NOME: ${departmentName}`,
          `DIVISAO_ID: ${user.divisionId ?? ""}`,
          `DIVISAO_NOME: ${divisionName}`,
          `TAGS: ${tags}`,
          "=============================================================================",
        ];

        const header = headerLines.join("\n");
        const originalText = textContent ?? fileBuffer.toString("utf-8");
        const textForIA = `${header}\n${originalText}`;

        app.log.info(
          { documentId, headerPreview: header },
          "[DOCS] Cabeçalho montado para IA (INLINE_TEXT)"
        );

        // Salva o conteúdo completo em DocumentText
        await pool
          .request()
          .input("DocumentId", sql.BigInt, documentId)
          .input("Content", sql.NVarChar(sql.MAX), textForIA)
          .query(`
            INSERT INTO DocumentText (DocumentId, Content)
            VALUES (@DocumentId, @Content);
          `);

        // Best-effort para IA Core
        try {
          await axios.post("http://localhost:4000/ingest", {
            documentId,
            text: textForIA,
            metadata: {
              companyId: user.companyId,
              companyName,
              departmentId: user.departmentId,
              departmentName,
              divisionId: user.divisionId,
              divisionName,
              ownerUserId: user.sub,
              tags,
            },
          });
          ingestStatus = "ok";
        } catch (ingestErr: any) {
          app.log.error(
            { err: ingestErr },
            "[DOCS] Falha ao chamar IA Core /ingest (INLINE_TEXT)"
          );
          ingestStatus = "failed";
        }
      } else {
        // Arquivo binário (PDF, Excel, imagem, etc.) → salvar em disco
        const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");

        const companyDir = path.join(STORAGE_ROOT, `company_${user.companyId}`);
        const docDir = path.join(companyDir, `doc_${documentId}`);

        await fs.mkdir(docDir, { recursive: true });

        const fullPath = path.join(docDir, safeFileName);

        await fs.writeFile(fullPath, fileBuffer);

        // Caminho relativo ao STORAGE_ROOT (para salvar no banco)
        const relativePath = path
          .relative(STORAGE_ROOT, fullPath)
          .replace(/\\/g, "/");

        // Atualiza o StoragePath no Documents
        await pool
          .request()
          .input("DocumentId", sql.Int, documentId)
          .input("StoragePath", sql.NVarChar, relativePath)
          .query(`
            UPDATE Documents
            SET StoragePath = @StoragePath
            WHERE DocumentId = @DocumentId;
          `);

        app.log.info(
          { documentId, fullPath },
          "[DOCS] Arquivo físico salvo (UPLOAD)"
        );

        // Por enquanto, não mandamos nada para IA em arquivos binários
        ingestStatus = "skipped";
      }

      return reply.send({
        success: true,
        message:
          ingestStatus === "ok"
            ? "Documento enviado e processado pela IA"
            : isFileUpload
            ? "Arquivo enviado e salvo com sucesso. Ingestão IA será configurada depois."
            : "Documento enviado. Ingestão pela IA será ajustada posteriormente.",
        documentId,
        ingestStatus,
      });
    } catch (err: any) {
      app.log.error({ err }, "Erro no upload de documento");

      if (err.name === "JsonWebTokenError") {
        return reply.status(401).send({ error: "Token inválido" });
      }

      return reply
        .status(500)
        .send({ error: "Falha no upload", details: err.message });
    }
  });

  /**
   * GET /documents
   */
  app.get("/documents", async (request: any, reply: any) => {
    try {
      const user = decodeUser(request);

      if (!user.companyId) {
        return reply
          .status(400)
          .send({ error: "Usuário sem empresa vinculada" });
      }

      if (user.role === "SUPER_ADMIN") {
        return reply.status(403).send({
          error:
            "SUPER_ADMIN não possui permissão para visualizar documentos (segurança da plataforma).",
        });
      }

      const q = request.query || {};
      const page = parseInt(q.page ?? "1", 10);
      const pageSize = parseInt(q.pageSize ?? "20", 10);
      const safePage = isNaN(page) || page < 1 ? 1 : page;
      const safePageSize =
        isNaN(pageSize) || pageSize < 1 || pageSize > 100 ? 20 : pageSize;
      const offset = (safePage - 1) * safePageSize;

      const filterDepartmentId = q.departmentId
        ? parseInt(q.departmentId, 10)
        : null;
      const filterDivisionId = q.divisionId
        ? parseInt(q.divisionId, 10)
        : null;
      const filterOwnerUserId = q.ownerUserId
        ? parseInt(q.ownerUserId, 10)
        : null;
      const filterCategory =
        typeof q.category === "string" && q.category.trim().length > 0
          ? q.category.trim()
          : null;
      const filterSearch =
        typeof q.search === "string" && q.search.trim().length > 0
          ? `%${q.search.trim()}%`
          : null;

      const pool = await getPool();

      const result = await pool
        .request()
        .input("CompanyId", sql.Int, user.companyId)
        .input("UserId", sql.Int, user.sub)
        .input("DepartmentId", sql.Int, user.departmentId ?? null)
        .input("DivisionId", sql.Int, user.divisionId ?? null)
        .input("Role", sql.NVarChar, user.role)
        .input("Offset", sql.Int, offset)
        .input("PageSize", sql.Int, safePageSize)
        .input("FilterDepartmentId", sql.Int, filterDepartmentId)
        .input("FilterDivisionId", sql.Int, filterDivisionId)
        .input("FilterOwnerUserId", sql.Int, filterOwnerUserId)
        .input("FilterCategory", sql.NVarChar, filterCategory)
        .input("SearchText", sql.NVarChar, filterSearch)
        .query(`
          ;WITH AllowedDocs AS (
            SELECT d.DocumentId
            FROM Documents d
            WHERE d.CompanyId = @CompanyId
              AND d.IsActive = 1
              AND (
                @Role = 'MASTER'
                OR (@Role = 'MANAGER' AND d.DepartmentId = @DepartmentId)
                OR (@Role = 'COORDINATOR' AND d.DepartmentId = @DepartmentId AND d.DivisionId = @DivisionId)
                OR (@Role = 'USER' AND d.OwnerUserId = @UserId)
              )
            UNION
            SELECT d2.DocumentId
            FROM Documents d2
            INNER JOIN DocumentAccess da
              ON da.DocumentId = d2.DocumentId
             AND da.CompanyId = d2.CompanyId
            WHERE d2.CompanyId = @CompanyId
              AND d2.IsActive = 1
              AND (
                da.AllowedUserId = @UserId
                OR (@DepartmentId IS NOT NULL AND da.AllowedDepartmentId = @DepartmentId)
                OR (@DivisionId IS NOT NULL AND da.AllowedDivisionId = @DivisionId)
              )
          )
          SELECT 
            d.DocumentId,
            d.Title,
            d.Description,
            d.Category,
            d.Tags,
            d.CompanyId,
            d.DepartmentId,
            d.DivisionId,
            d.OwnerUserId,
            u.Name AS OwnerName,
            d.StorageType,
            d.StoragePath,
            d.MimeType,
            d.FileSizeBytes,
            d.Version,
            d.IsActive,
            d.CreatedAt,
            d.UpdatedAt,
            COUNT(*) OVER() AS TotalCount
          FROM Documents d
          INNER JOIN (
            SELECT DISTINCT DocumentId FROM AllowedDocs
          ) a ON a.DocumentId = d.DocumentId
          LEFT JOIN Users u ON u.UserId = d.OwnerUserId
          WHERE
            (@FilterDepartmentId IS NULL OR d.DepartmentId = @FilterDepartmentId)
            AND (@FilterDivisionId IS NULL OR d.DivisionId = @FilterDivisionId)
            AND (@FilterOwnerUserId IS NULL OR d.OwnerUserId = @FilterOwnerUserId)
            AND (@FilterCategory IS NULL OR d.Category = @FilterCategory)
            AND (
              @SearchText IS NULL
              OR d.Title LIKE @SearchText
              OR d.Tags LIKE @SearchText
            )
          ORDER BY d.CreatedAt DESC
          OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        `);

      const rows = result.recordset || [];
      const totalCount =
        rows.length > 0 && rows[0].TotalCount != null
          ? Number(rows[0].TotalCount)
          : 0;

      return reply.send({
        page: safePage,
        pageSize: safePageSize,
        totalCount,
        documents: rows,
      });
    } catch (err: any) {
      app.log.error({ err }, "[DOCS] Erro ao listar documentos");

      if (err.name === "JsonWebTokenError") {
        return reply.status(401).send({ error: "Token inválido" });
      }

      return reply
        .status(500)
        .send({ error: "Falha ao listar documentos", details: err.message });
    }
  });

  /**
   * GET /documents/:id
   */
  app.get("/documents/:id", async (request: any, reply: any) => {
    try {
      const user = decodeUser(request);
      const documentId = parseInt(request.params.id, 10);

      if (isNaN(documentId)) {
        return reply.status(400).send({ error: "DocumentId inválido" });
      }

      if (!user.companyId) {
        return reply
          .status(400)
          .send({ error: "Usuário sem empresa vinculada" });
      }

      if (user.role === "SUPER_ADMIN") {
        return reply.status(403).send({
          error:
            "SUPER_ADMIN não possui permissão para visualizar documentos (segurança da plataforma).",
        });
      }

      const pool = await getPool();

      const result = await pool
        .request()
        .input("CompanyId", sql.Int, user.companyId)
        .input("UserId", sql.Int, user.sub)
        .input("DepartmentId", sql.Int, user.departmentId ?? null)
        .input("DivisionId", sql.Int, user.divisionId ?? null)
        .input("Role", sql.NVarChar, user.role)
        .input("DocumentId", sql.Int, documentId)
        .query(`
          SELECT TOP 1
            d.DocumentId,
            d.CompanyId,
            d.DepartmentId,
            d.DivisionId,
            d.OwnerUserId,
            u.Name AS OwnerName,
            d.Title,
            d.Description,
            d.Category,
            d.Tags,
            d.StorageType,
            d.StoragePath,
            d.MimeType,
            d.FileSizeBytes,
            d.Version,
            d.IsActive,
            d.CreatedAt,
            d.UpdatedAt
          FROM Documents d
          LEFT JOIN Users u
            ON u.UserId = d.OwnerUserId
          LEFT JOIN DocumentAccess da
            ON da.DocumentId = d.DocumentId
           AND da.CompanyId = d.CompanyId
          WHERE d.DocumentId = @DocumentId
            AND d.CompanyId = @CompanyId
            AND d.IsActive = 1
            AND (
              (@Role = 'MASTER')
              OR (@Role = 'MANAGER' AND d.DepartmentId = @DepartmentId)
              OR (@Role = 'COORDINATOR'
                  AND d.DepartmentId = @DepartmentId
                  AND (d.DivisionId = @DivisionId OR d.OwnerUserId = @UserId)
              )
              OR (@Role = 'USER' AND d.OwnerUserId = @UserId)
              OR (da.AllowedUserId = @UserId)
              OR (@DepartmentId IS NOT NULL AND da.AllowedDepartmentId = @DepartmentId)
              OR (@DivisionId IS NOT NULL AND da.AllowedDivisionId = @DivisionId)
            );
        `);

      if (result.recordset.length === 0) {
        return reply
          .status(404)
          .send({ error: "Documento não encontrado ou sem permissão" });
      }

      const doc = result.recordset[0];

      return reply.send({
        document: doc,
      });
    } catch (err: any) {
      app.log.error({ err }, "[DOCS] Erro ao buscar documento por id");

      if (err.name === "JsonWebTokenError") {
        return reply.status(401).send({ error: "Token inválido" });
      }

      return reply.status(500).send({
        error: "Falha ao buscar documento",
        details: err.message,
      });
    }
  });

  /**
   * POST /documents/:id/share
   */
  app.post("/documents/:id/share", async (request: any, reply: any) => {
    try {
      const user = decodeUser(request);
      const documentId = parseInt(request.params.id, 10);

      if (isNaN(documentId)) {
        return reply.status(400).send({ error: "DocumentId inválido" });
      }

      if (!user.companyId) {
        return reply
          .status(400)
          .send({ error: "Usuário não vinculado a uma empresa" });
      }

      const body = request.body || {};
      const { allowedUserId, allowedDepartmentId, allowedDivisionId } = body;

      if (!allowedUserId && !allowedDepartmentId && !allowedDivisionId) {
        return reply.status(400).send({
          error:
            "Informe pelo menos um dos campos: allowedUserId, allowedDepartmentId ou allowedDivisionId",
        });
      }

      const pool = await getPool();

      const check = await pool
        .request()
        .input("DocumentId", sql.Int, documentId)
        .input("CompanyId", sql.Int, user.companyId)
        .query(`
          SELECT DocumentId, OwnerUserId, DepartmentId, DivisionId
          FROM Documents
          WHERE DocumentId = @DocumentId
            AND CompanyId = @CompanyId;
        `);

      if (check.recordset.length === 0) {
        return reply.status(404).send({
          error: "Documento não encontrado ou não pertence à sua empresa",
        });
      }

      const doc = check.recordset[0];

      switch (user.role) {
        case "SUPER_ADMIN":
          return reply.status(403).send({
            error: "SUPER_ADMIN não pode compartilhar documentos.",
          });
        case "MASTER":
          break;
        case "MANAGER": {
          const depCheck = await pool
            .request()
            .input("DocumentId", sql.Int, documentId)
            .input("DepartmentId", sql.Int, user.departmentId)
            .query(`
              SELECT 1 FROM Documents
              WHERE DocumentId = @DocumentId
                AND DepartmentId = @DepartmentId;
            `);
          if (depCheck.recordset.length === 0) {
            return reply.status(403).send({
              error:
                "MANAGER só pode compartilhar documentos do seu departamento.",
            });
          }
          break;
        }
        case "COORDINATOR": {
          const divCheck = await pool
            .request()
            .input("DocumentId", sql.Int, documentId)
            .input("DivisionId", sql.Int, user.divisionId)
            .query(`
              SELECT 1 FROM Documents
              WHERE DocumentId = @DocumentId
                AND DivisionId = @DivisionId;
            `);
          if (divCheck.recordset.length === 0) {
            return reply.status(403).send({
              error:
                "COORDINATOR só pode compartilhar documentos da sua divisão.",
            });
          }
          break;
        }
        case "USER":
          if (doc.OwnerUserId !== user.sub) {
            return reply.status(403).send({
              error: "USER só pode compartilhar seus próprios documentos.",
            });
          }
          break;
      }

      await pool
        .request()
        .input("DocumentId", sql.Int, documentId)
        .input("CompanyId", sql.Int, user.companyId)
        .input("AllowedUserId", sql.Int, allowedUserId ?? null)
        .input("AllowedDepartmentId", sql.Int, allowedDepartmentId ?? null)
        .input("AllowedDivisionId", sql.Int, allowedDivisionId ?? null)
        .query(`
          INSERT INTO DocumentAccess (
            DocumentId,
            CompanyId,
            AllowedUserId,
            AllowedDepartmentId,
            AllowedDivisionId,
            CreatedAt
          )
          VALUES (
            @DocumentId,
            @CompanyId,
            @AllowedUserId,
            @AllowedDepartmentId,
            @AllowedDivisionId,
            SYSDATETIME()
          );
        `);

      return reply.send({
        success: true,
        message: "Acesso concedido com sucesso.",
        documentId,
        sharedWith: {
          allowedUserId,
          allowedDepartmentId,
          allowedDivisionId,
        },
      });
    } catch (err: any) {
      app.log.error({ err }, "[DOCS] Erro ao compartilhar documento");
      return reply.status(500).send({
        error: "Falha ao compartilhar documento",
        details: err.message,
      });
    }
  });
}
