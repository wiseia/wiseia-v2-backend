// src/ai/fileParser.ts
// Funções para extrair texto de buffers de arquivos.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import csv from 'csv-parser';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
// ❌ REMOVIDO: import type { ParsedFile } from './types.js';

export interface ParsedFile {
  rawText: string;
  mime: string;
  sizeBytes: number;
  sourceFilename: string;
}

async function streamBufferToCsvText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const rows: string[] = [];
    const rs = Readable.from([buffer]);
    rs.pipe(csv())
      .on('data', (row) => rows.push(JSON.stringify(row)))
      .on('end', () => resolve(rows.join('\n')))
      .on('error', reject);
  });
}

export async function parseBufferToText(input: {
  buffer: Buffer;
  filename: string;
  mime?: string;
}): Promise<ParsedFile> {
  const { buffer, filename, mime } = input;
  const sizeBytes = buffer.length;
  const ext = path.extname(filename || '').toLowerCase();

  // default mime
  const outMime =
    mime ??
    (ext === '.csv'
      ? 'text/csv'
      : ext === '.xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/octet-stream');

  let rawText = '';
  let tmpPath: string | null = null;

  try {
    if (ext === '.csv') {
      rawText = await streamBufferToCsvText(buffer);
    } else if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rawText = sheet ? XLSX.utils.sheet_to_csv(sheet) : '';
    } else if (ext === '.docx') {
      // mammoth funciona melhor com path de arquivo: gravamos temporário
      tmpPath = path.join(
        os.tmpdir(),
        `wiseia-docx-${Date.now()}-${Math.random().toString(16).slice(2)}.docx`,
      );
      await fs.writeFile(tmpPath, buffer);
      const { value } = await mammoth.extractRawText({ path: tmpPath });
      rawText = String(value || '');
    } else if (ext === '.txt' || ext === '') {
      rawText = buffer.toString('utf-8');
    } else if (ext === '.json') {
      try {
        const obj = JSON.parse(buffer.toString('utf-8'));
        rawText = JSON.stringify(obj, null, 2);
      } catch (e) {
        rawText = buffer.toString('utf-8');
      }
    } else if (ext === '.pdf') {
      // PDF: ainda não implementado aqui (pode exigir OCR ou serviço externo).
      rawText = '';
    } else {
      // Fallback: tenta decodificar como UTF-8
      rawText = buffer.toString('utf-8');
    }
  } finally {
    if (tmpPath) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    rawText,
    mime: outMime,
    sizeBytes,
    sourceFilename: filename,
  };
}
