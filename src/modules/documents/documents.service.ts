// src/modules/documents/documents.service.ts
import { getDocumentDetails } from './documents.repository.js';
import { DecodedToken } from '../../types/DecodedToken.js';


export async function getDocumentByIdService(
  documentId: number,
  user: DecodedToken
) {
  const document = await getDocumentDetails(documentId);

  if (!document) return null;

  // PERMISSÃO
  const isOwner = document.uploadedBy?.id === user.idUsuario;
  const sameDept = document.departmentId === user.departmentId;
  const sameDivision =
    !document.divisionId || document.divisionId === user.divisionId;

  const isMaster = user.role === 'MASTER';
  const isAdmin = user.role === 'ADMIN';
  const isSuper = user.role === 'SUPER_ADMIN';

  if (isOwner || sameDept || sameDivision || isMaster || isAdmin || isSuper) {
    return document;
  }

  return null;
}
