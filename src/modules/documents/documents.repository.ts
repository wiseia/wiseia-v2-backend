// src/modules/documents/documents.repository.ts
import { getPool, sql } from '../../db.js';
import { DocumentDetailsResponse } from './dto/DocumentDetailsResponse.js';

export async function getDocumentDetails(
  documentId: number
): Promise<DocumentDetailsResponse | null> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('documentId', sql.BigInt, documentId)
    .query(`
      SELECT 
        d.DocumentId,
        d.CompanyId,
        d.DepartmentId,
        d.DivisionId,
        d.Title AS Name,
        d.StoragePath,
        d.MimeType,
        d.FileSizeBytes,
        d.CreatedAt,
        d.UpdatedAt,

        u.UserId AS UploadedById,
        u.Name AS UploadedByName

      FROM Documents d
      LEFT JOIN Users u ON u.UserId = d.OwnerUserId
      WHERE d.DocumentId = @documentId
    `);

  if (result.recordset.length === 0) return null;

  const row = result.recordset[0];

  return {
    id: row.DocumentId,
    companyId: row.CompanyId,
    departmentId: row.DepartmentId,
    divisionId: row.DivisionId,

    name: row.Name,
    originalFileName: row.Name,
    mimeType: row.MimeType,
    sizeInBytes: row.FileSizeBytes,

    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,

    uploadedBy: row.UploadedById
      ? {
          id: row.UploadedById,
          name: row.UploadedByName,
        }
      : null,
  };
}
// 🔎 Busca informações básicas do arquivo para OCR / processamento
export async function getDocumentFileInfo(documentId: number) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('documentId', sql.BigInt, documentId)
    .query(`
      SELECT
        d.DocumentId,
        d.CompanyId,
        d.StorageType,
        d.StoragePath,
        d.MimeType
      FROM Documents d
      WHERE d.DocumentId = @documentId
        AND d.IsActive = 1
    `);

  if (result.recordset.length === 0) {
    return null;
  }

  return result.recordset[0];
}
// ------------------------------------------------------------
// Storage do documento (para OCR / download de arquivo físico)
// ------------------------------------------------------------
export async function getDocumentStorageInfo(documentId: number) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('documentId', sql.BigInt, documentId)
    .query(`
      SELECT TOP 1
        d.DocumentId,
        d.CompanyId,
        d.StorageType,
        d.StoragePath
      FROM Documents d
      WHERE d.DocumentId = @documentId
    `);

  return result.recordset[0] ?? null;
}

// ------------------------------------------------------------
// Gravar texto extraído por OCR em DocumentText
// ------------------------------------------------------------
export async function saveOcrText(documentId: number, content: string) {
  const pool = await getPool();

  await pool
    .request()
    .input('documentId', sql.BigInt, documentId)
    .input('content', sql.NVarChar(sql.MAX), content)
    .query(`
      MERGE DocumentText AS target
      USING (SELECT @documentId AS DocumentId) AS source
      ON target.DocumentId = source.DocumentId
      WHEN MATCHED THEN
        UPDATE SET
          Content   = @content,
          UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (DocumentId, Content, CreatedAt, UpdatedAt)
        VALUES (@documentId, @content, SYSDATETIME(), SYSDATETIME());
    `);
}
// src/modules/documents/documents.repository.ts

// ...

// 🔹 Pega o texto OCR de um documento
export async function getDocumentOcrText(documentId: number): Promise<string | null> {
  const pool = await getPool();

  const result = await pool.request()
    .input('documentId', sql.BigInt, documentId)
    .query(`
      SELECT TOP 1 Content
      FROM DocumentText
      WHERE DocumentId = @documentId
      ORDER BY UpdatedAt DESC, CreatedAt DESC
    `);

  if (!result.recordset.length) {
    return null;
  }

  return result.recordset[0].Content as string;
}

// 🔹 Remove chunks e embeddings antigos de um documento
export async function deleteChunksAndEmbeddingsForDocument(documentId: number): Promise<void> {
  const pool = await getPool();

  await pool.request()
    .input('documentId', sql.BigInt, documentId)
    .query(`
      -- Primeiro remove embeddings ligados aos chunks do documento
      DELETE CE
      FROM ChunkEmbeddings CE
      INNER JOIN Chunks C ON C.ChunkId = CE.ChunkId
      WHERE C.DocumentId = @documentId;

      -- Depois remove os chunks
      DELETE FROM Chunks
      WHERE DocumentId = @documentId;
    `);
}

// 🔹 Insere um chunk e retorna o ChunkId
export async function insertChunk(
  documentId: number,
  orderIndex: number,
  content: string,
): Promise<number> {
  const pool = await getPool();

  const result = await pool.request()
    .input('documentId', sql.BigInt, documentId)
    .input('orderIndex', sql.Int, orderIndex)
    .input('content', sql.NVarChar(sql.MAX), content)
    .query(`
      INSERT INTO Chunks (DocumentId, [OrderIndex], Content, CreatedAt)
      VALUES (@documentId, @orderIndex, @content, SYSUTCDATETIME());

      SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS ChunkId;
    `);

  return Number(result.recordset[0].ChunkId);
}

// 🔹 Salva embedding de um chunk
export async function insertChunkEmbedding(
  chunkId: number,
  embedding: number[],
  provider: string,
  model: string,
): Promise<void> {
  const pool = await getPool();

  const embeddingJson = JSON.stringify(embedding);
  const dimensions = embedding.length;

  await pool.request()
    .input('chunkId', sql.BigInt, chunkId)
    .input('provider', sql.NVarChar(50), provider)
    .input('model', sql.NVarChar(100), model)
    .input('dimensions', sql.Int, dimensions)
    .input('embeddingJson', sql.NVarChar(sql.MAX), embeddingJson)
    .query(`
      INSERT INTO ChunkEmbeddings (ChunkId, Provider, Model, Dimensions, EmbeddingJson, CreatedAt)
      VALUES (@chunkId, @provider, @model, @dimensions, @embeddingJson, SYSUTCDATETIME());
    `);
}
