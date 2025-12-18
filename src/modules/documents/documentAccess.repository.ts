// src/modules/documents/documentAccess.repository.ts
import { sqlPool } from '../../infra/db/sqlServer.js';

export async function isDocumentSharedWithUser(
  documentId: number,
  userId: number
): Promise<boolean> {
  const pool = await sqlPool.connect();

  const result = await pool.request()
    .input("DocumentId", documentId)
    .input("UserId", userId)
    .query<{ Count: number }>(`
      SELECT COUNT(1) AS Count
      FROM DocumentAccess
      WHERE DocumentId = @DocumentId
        AND UserId = @UserId
    `);

  return (result.recordset[0]?.Count ?? 0) > 0;
}
