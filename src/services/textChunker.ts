// src/services/textChunker.ts

export interface Chunk {
    text: string;
    index: number;
    characterCount: number;
}

/**
 * Chunk text intelligently into pieces suitable for RAG
 * 
 * Strategy:
 * - Target size: 500-1000 characters per chunk
 * - Respect paragraph boundaries (double newline)
 * - If paragraph too long, split by sentences
 * - Add small overlap between chunks for context
 * 
 * @param text Full text to chunk
 * @param targetSize Target characters per chunk (default 800)
 * @param overlap Characters to overlap between chunks (default 100)
 */
export function chunkText(
    text: string,
    targetSize: number = 800,
    overlap: number = 100
): Chunk[] {
    if (!text || text.trim().length === 0) {
        return [];
    }

    const chunks: Chunk[] = [];

    // Split by paragraphs (double newline or single newline)
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    let currentChunk = '';
    let chunkIndex = 0;
    let previousChunkEnd = '';

    for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();

        // If adding this paragraph exceeds target size
        if (currentChunk.length > 0 && (currentChunk.length + trimmedParagraph.length) > targetSize) {
            // Save current chunk
            const finalChunk = previousChunkEnd + currentChunk;
            chunks.push({
                text: finalChunk.trim(),
                index: chunkIndex++,
                characterCount: finalChunk.length
            });

            // Keep overlap from end of current chunk
            previousChunkEnd = getOverlap(currentChunk, overlap);
            currentChunk = trimmedParagraph + '\n\n';
        }
        // If single paragraph is too large, split by sentences
        else if (trimmedParagraph.length > targetSize * 1.5) {
            // Save any accumulated chunk first
            if (currentChunk.length > 0) {
                const finalChunk = previousChunkEnd + currentChunk;
                chunks.push({
                    text: finalChunk.trim(),
                    index: chunkIndex++,
                    characterCount: finalChunk.length
                });
                previousChunkEnd = getOverlap(currentChunk, overlap);
                currentChunk = '';
            }

            // Split large paragraph by sentences
            const sentences = splitIntoSentences(trimmedParagraph);
            let sentenceChunk = '';

            for (const sentence of sentences) {
                if (sentenceChunk.length > 0 && (sentenceChunk.length + sentence.length) > targetSize) {
                    // Save sentence chunk
                    const finalChunk = previousChunkEnd + sentenceChunk;
                    chunks.push({
                        text: finalChunk.trim(),
                        index: chunkIndex++,
                        characterCount: finalChunk.length
                    });
                    previousChunkEnd = getOverlap(sentenceChunk, overlap);
                    sentenceChunk = sentence + ' ';
                } else {
                    sentenceChunk += sentence + ' ';
                }
            }

            // Add remaining sentence chunk to current
            if (sentenceChunk.trim().length > 0) {
                currentChunk = sentenceChunk + '\n\n';
            }
        }
        // Normal case: add paragraph to current chunk
        else {
            currentChunk += trimmedParagraph + '\n\n';
        }
    }

    // Add final chunk if any
    if (currentChunk.trim().length > 0) {
        const finalChunk = previousChunkEnd + currentChunk;
        chunks.push({
            text: finalChunk.trim(),
            index: chunkIndex++,
            characterCount: finalChunk.length
        });
    }

    return chunks;
}

/**
 * Get overlap text from end of chunk
 */
function getOverlap(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) {
        return text;
    }

    // Get last `overlapSize` characters, but try to start at word boundary
    const endPart = text.slice(-overlapSize);
    const firstSpace = endPart.indexOf(' ');

    if (firstSpace > 0 && firstSpace < overlapSize / 2) {
        return endPart.slice(firstSpace + 1);
    }

    return endPart;
}

/**
 * Split text into sentences
 * Simple heuristic: split on ., !, ? followed by space and capital letter
 */
function splitIntoSentences(text: string): string[] {
    // Split on sentence endings, but keep the punctuation
    const sentences = text.split(/([.!?]+\s+)/).filter(s => s.trim().length > 0);

    // Recombine sentences with their punctuation
    const result: string[] = [];
    for (let i = 0; i < sentences.length; i += 2) {
        const sentence = sentences[i];
        const punctuation = sentences[i + 1] || '';
        result.push((sentence + punctuation).trim());
    }

    return result.filter(s => s.length > 0);
}
