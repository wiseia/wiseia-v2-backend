// src/modules/documents/dto/DocumentDetailsResponse.ts
export interface DocumentDetailsResponse {
  id: number;
  companyId: number;
  departmentId: number | null;
  divisionId: number | null;

  name: string;
  originalFileName: string;
  mimeType: string;
  sizeInBytes: number;

  createdAt: string;
  updatedAt: string | null;

  uploadedBy: {
    id: number;
    name: string;
  } | null;
}
