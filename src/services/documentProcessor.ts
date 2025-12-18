// src/services/documentProcessor.ts
import fs from 'fs/promises';
import path from 'path';
import { getPool, sql } from '../db.js';
import { chunkText } from './textChunker.js';
// @ts-ignore - pdf-parse doesn't have proper types
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { randomUUID } from 'crypto';

interface ProcessResult {
    success: boolean;
    chunksCreated: number;
    text?: string;
    error?: string;
    metadata?: {
        pageCount?: number;
        sheetCount?: number;
        wordCount?: number;
    };
}

/**
 * Process a document: extract text, create chunks, save to database
 */
export async function processDocument(
    documentId: string,
    filePath: string,
    fileType: string
): Promise<ProcessResult> {
    try {
        console.log(`[DocumentProcessor] Processing document ${documentId}, type: ${fileType}`);

        // Extract text based on file type
        const { text, metadata } = await extractText(filePath, fileType);

        if (!text || text.trim().length === 0) {
            return {
                success: false,
                chunksCreated: 0,
                error: 'No text extracted from document'
            };
        }

        // Create chunks
        const chunks = chunkText(text);

        // Save chunks to database
        const pool = await getPool();
        let chunksCreated = 0;

        for (const chunk of chunks) {
            const chunkId = randomUUID();
            await pool.request()
                .input('chunkId', sql.UniqueIdentifier, chunkId)
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('chunkIndex', sql.Int, chunk.index)
                .input('chunkText', sql.NVarChar(sql.MAX), chunk.text)
                .input('tokenCount', sql.Int, Math.ceil(chunk.text.length / 4)) // Rough estimate
                .query(`
                    INSERT INTO DocumentChunks (
                        ChunkID, DocumentID, ChunkIndex, ChunkText, TokenCount, CreatedAt
                    )
                    VALUES (
                        @chunkId, @documentId, @chunkIndex, @chunkText, @tokenCount, GETUTCDATE()
                    )
                `);
            chunksCreated++;
        }

        // Update document status to 'processed'
        await pool.request()
            .input('documentId', sql.UniqueIdentifier, documentId)
            .query(`
                UPDATE Documents 
                SET Status = 'processed', ProcessedAt = GETUTCDATE()
                WHERE DocumentID = @documentId
            `);

        console.log(`[DocumentProcessor] Successfully processed document ${documentId}: ${chunksCreated} chunks created`);

        return {
            success: true,
            chunksCreated,
            text,
            metadata
        };
    } catch (error: any) {
        console.error(`[DocumentProcessor] Error processing document ${documentId}:`, error);

        // Update document status to 'error'
        try {
            const pool = await getPool();
            await pool.request()
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('error', sql.NVarChar(sql.MAX), error.message)
                .query(`
                    UPDATE Documents 
                    SET Status = 'error', ProcessingError = @error
                    WHERE DocumentID = @documentId
                `);
        } catch (dbError) {
            console.error('[DocumentProcessor] Failed to update error status:', dbError);
        }

        return {
            success: false,
            chunksCreated: 0,
            error: error.message
        };
    }
}

/**
 * Extract text from file based on type
 */
async function extractText(
    filePath: string,
    fileType: string
): Promise<{ text: string; metadata?: any }> {
    const normalizedType = fileType.toLowerCase();

    switch (normalizedType) {
        case '.txt':
            return extractTextFromTxt(filePath);
        case '.csv':
            return extractTextFromCsv(filePath);
        case '.pdf':
            return extractTextFromPdf(filePath);
        case '.docx':
            return extractTextFromDocx(filePath);
        case '.xlsx':
        case '.xls':
            return extractTextFromXlsx(filePath);
        default:
            throw new Error(`Unsupported file type: ${fileType}`);
    }
}

/**
 * Extract text from TXT file
 */
async function extractTextFromTxt(filePath: string): Promise<{ text: string }> {
    const buffer = await fs.readFile(filePath);

    // Try UTF-8 first
    try {
        const text = buffer.toString('utf-8');
        return { text };
    } catch (error) {
        // Fallback to Latin-1
        const text = buffer.toString('latin1');
        return { text };
    }
}

/**
 * Extract text from CSV file
 */
async function extractTextFromCsv(filePath: string): Promise<{ text: string }> {
    const content = await fs.readFile(filePath, 'utf-8');

    // Simple CSV parsing: convert to readable text format
    const lines = content.split('\n');
    const formattedLines = lines.map((line, index) => {
        if (index === 0) {
            return `Headers: ${line}`;
        }
        return `Row ${index}: ${line}`;
    });

    return { text: formattedLines.join('\n') };
}

/**
 * Extract text from PDF file
 */
async function extractTextFromPdf(filePath: string): Promise<{ text: string; metadata: any }> {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);

    return {
        text: data.text,
        metadata: {
            pageCount: data.numpages,
            info: data.info
        }
    };
}

/**
 * Extract text from DOCX file
 */
async function extractTextFromDocx(filePath: string): Promise<{ text: string }> {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });

    return { text: result.value };
}

/**
 * Extract text from XLSX/XLS file
 */
async function extractTextFromXlsx(filePath: string): Promise<{ text: string; metadata: any }> {
    const workbook = xlsx.readFile(filePath);

    let allText = '';
    const sheetNames = workbook.SheetNames;

    for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const sheetData = xlsx.utils.sheet_to_csv(sheet);
        allText += `\n=== Sheet: ${sheetName} ===\n${sheetData}\n`;
    }

    return {
        text: allText,
        metadata: {
            sheetCount: sheetNames.length,
            sheetNames
        }
    };
}
