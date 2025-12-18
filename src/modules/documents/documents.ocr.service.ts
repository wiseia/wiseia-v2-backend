// src/modules/documents/documents.ocr.service.ts
import fs from 'fs/promises';
import path from 'path';
import { getDocumentStorageInfo, saveOcrText } from './documents.repository.js';

// @ts-ignore – pdfjs-dist + Node + TS é chatinho, tratamos manualmente
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Pega apenas o getDocument, não vamos usar worker
const { getDocument } = pdfjsLib as any;

export interface OcrResult {
  documentId: number;
  ocrTextLength: number;
}

/**
 * Extrai texto de um PDF usando pdfjs-dist (sem OCR de imagem).
 * Salva o texto na tabela DocumentText e retorna métricas básicas.
 */
export async function runOcrForDocument(
  documentId: number
): Promise<OcrResult> {
  const storage = await getDocumentStorageInfo(documentId);

  if (!storage) {
    throw new Error('Documento não encontrado');
  }

  if (storage.StorageType !== 'DISK_FILE') {
    throw new Error('Documento não está salvo como arquivo físico (DISK_FILE)');
  }

  // Ex.: "company_1/doc_9/Carta_aos_fornecedores_para_troca_CNPJ.pdf"
  const relativePath = String(storage.StoragePath || '').replace(/^[/\\]+/, '');
  const filePath = path.join(process.cwd(), 'uploads', relativePath);

  console.log('[OCR] Lendo arquivo em:', filePath);

  // Lê o arquivo como Buffer
  const fileBuffer = await fs.readFile(filePath);

  // ⚠️ pdfjs-dist quer Uint8Array, não Buffer
  const uint8Array = new Uint8Array(fileBuffer);

  // 👇 Aqui está o pulo do gato: desabilitar o worker
  const loadingTask = getDocument({
    data: uint8Array,
    disableWorker: true, // evita erro de GlobalWorkerOptions.workerSrc
  });

  const pdf = await loadingTask.promise;

  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const pageText = (content.items as any[])
      .map((item) => (item as any).str || '')
      .join(' ')
      .trim();

    fullText += pageText + '\n';
  }

  if (!fullText.trim()) {
    // Pipeline ok, mas PDF não tem texto (só imagem)
    throw new Error(
      'PDF não contém texto extraível (talvez seja apenas imagem escaneada)'
    );
  }

  await saveOcrText(documentId, fullText);

  return {
    documentId,
    ocrTextLength: fullText.length,
  };
}

