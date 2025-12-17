import { getPool, sql } from '../db.js';
import { openai, OPENAI_MODEL } from '../lib/openaiClient.js';
import { randomUUID } from 'crypto';

// ==================== TIPOS ====================

export interface DocumentMetadata {
    documentId: string;
    documentType?: string;
    documentCategory?: string;
    issueDate?: Date;
    expirationDate?: Date;
    validUntil?: Date;
    parties?: string[];
    amounts?: Array<{ value: number; currency: string; description?: string }>;
    keyTerms?: string[];
    extractedData: Record<string, any>;
    confidence: number;
}

export interface ExpirationInfo {
    documentId: string;
    documentTitle: string;
    expirationDate: Date;
    daysUntilExpiration: number;
    urgencyLevel: 'urgent' | 'high' | 'medium' | 'low';
    documentType?: string;
}

export interface SmartAlert {
    type: string;
    priority: 'urgent' | 'high' | 'medium' | 'low';
    title: string;
    message: string;
    documentId: string;
    triggerDate?: Date;
    metadata?: Record<string, any>;
}

export interface DocumentSummary {
    summary: string;
    keyPoints: string[];
    actionItems?: string[];
    warnings?: string[];
    confidence: number;
}

export interface TagSuggestion {
    tag: string;
    confidence: number;
    reason?: string;
}

// ==================== FUNÇÕES AUXILIARES ====================

/**
 * Obter texto completo do documento a partir dos chunks
 */
async function getDocumentText(documentId: string): Promise<string> {
    const pool = await getPool();
    const result = await pool
        .request()
        .input('documentId', sql.UniqueIdentifier, documentId)
        .query(`
      SELECT ChunkText
      FROM DocumentChunks
      WHERE DocumentID = @documentId
      ORDER BY ChunkIndex ASC
    `);

    return result.recordset.map((row: any) => row.ChunkText).join('\n\n');
}

/**
 * Salvar metadados extraídos no banco
 */
async function saveExtractedMetadata(
    documentId: string,
    metadata: Record<string, any>
): Promise<void> {
    const pool = await getPool();

    for (const [key, value] of Object.entries(metadata)) {
        if (value === null || value === undefined) continue;

        const metadataId = randomUUID();
        let valueType = typeof value;
        let metadataValue = value;

        // Serializar objetos e arrays como JSON
        if (typeof value === 'object') {
            valueType = 'json';
            metadataValue = JSON.stringify(value);
        }

        await pool
            .request()
            .input('metadataId', sql.UniqueIdentifier, metadataId)
            .input('documentId', sql.UniqueIdentifier, documentId)
            .input('metadataKey', sql.NVarChar(255), key)
            .input('metadataValue', sql.NVarChar(sql.MAX), String(metadataValue))
            .input('valueType', sql.NVarChar(50), valueType)
            .input('confidence', sql.Float, metadata.confidence || 0.8)
            .input('extractedBy', sql.NVarChar(100), OPENAI_MODEL)
            .query(`
        INSERT INTO ExtractedMetadata (
          MetadataID, DocumentID, MetadataKey, MetadataValue,
          ValueType, Confidence, ExtractedBy
        )
        VALUES (
          @metadataId, @documentId, @metadataKey, @metadataValue,
          @valueType, @confidence, @extractedBy
        )
      `);
    }

    console.log(`[Proactive] Saved ${Object.keys(metadata).length} metadata entries for document ${documentId}`);
}

/**
 * Criar alerta no banco de dados
 */
async function createAlert(
    alert: SmartAlert,
    companyId: string,
    userId?: string
): Promise<void> {
    const pool = await getPool();
    const alertId = randomUUID();

    await pool
        .request()
        .input('alertId', sql.UniqueIdentifier, alertId)
        .input('companyId', sql.UniqueIdentifier, companyId)
        .input('userId', sql.UniqueIdentifier, userId || null)
        .input('documentId', sql.UniqueIdentifier, alert.documentId)
        .input('type', sql.NVarChar(50), alert.type)
        .input('priority', sql.NVarChar(20), alert.priority)
        .input('title', sql.NVarChar(500), alert.title)
        .input('message', sql.NVarChar(sql.MAX), alert.message)
        .input('triggerDate', sql.DateTime2, alert.triggerDate || null)
        .query(`
      INSERT INTO Alerts (
        AlertID, CompanyID, UserID, DocumentID, Type, Priority,
        Title, Message, TriggerDate
      )
      VALUES (
        @alertId, @companyId, @userId, @documentId, @type, @priority,
        @title, @message, @triggerDate
      )
    `);

    console.log(`[Proactive] Created ${alert.priority} alert: ${alert.title}`);
}

// ==================== ANÁLISE DE DOCUMENTO ====================

/**
 * Detectar tipo e categoria do documento usando IA
 */
async function detectDocumentType(text: string): Promise<{
    documentType: string;
    documentCategory: string;
    confidence: number;
}> {
    const prompt = `
Analise o seguinte texto de documento e identifique:
1. O tipo específico (ex: "Contrato de Prestação de Serviços", "Nota Fiscal", "Certidão Negativa")
2. A categoria geral (ex: "Contrato", "Fatura", "Certificado", "Política", "Relatório")

Responda APENAS em formato JSON:
{
  "documentType": "tipo específico do documento",
  "documentCategory": "categoria geral",
  "confidence": 0.0-1.0
}

Texto do documento:
${text.substring(0, 3000)}
`.trim();

    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return {
        documentType: result.documentType || 'Desconhecido',
        documentCategory: result.documentCategory || 'Outros',
        confidence: result.confidence || 0.5
    };
}

/**
 * Detectar expirações e datas importantes
 */
export async function detectExpirations(documentId: string): Promise<ExpirationInfo | null> {
    const text = await getDocumentText(documentId);

    const prompt = `
Analise o seguinte documento e identifique TODAS as datas importantes, especialmente:
- Data de vencimento / expiração / validade
- Data de emissão
- Prazos e deadlines

Responda APENAS em formato JSON:
{
  "issueDate": "YYYY-MM-DD ou null",
  "expirationDate": "YYYY-MM-DD ou null",
  "validUntil": "YYYY-MM-DD ou null",
  "otherDates": [{"type": "descrição", "date": "YYYY-MM-DD"}]
}

Se não encontrar datas, retorne null nos campos.

Texto do documento:
${text.substring(0, 2000)}
`.trim();

    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

    if (!result.expirationDate) {
        return null;
    }

    const expirationDate = new Date(result.expirationDate);
    const today = new Date();
    const daysUntilExpiration = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let urgencyLevel: 'urgent' | 'high' | 'medium' | 'low';
    if (daysUntilExpiration <= 7) urgencyLevel = 'urgent';
    else if (daysUntilExpiration <= 15) urgencyLevel = 'high';
    else if (daysUntilExpiration <= 30) urgencyLevel = 'medium';
    else urgencyLevel = 'low';

    // Buscar título do documento
    const pool = await getPool();
    const docResult = await pool
        .request()
        .input('documentId', sql.UniqueIdentifier, documentId)
        .query('SELECT Title FROM Documents WHERE DocumentID = @documentId');

    const documentTitle = docResult.recordset[0]?.Title || 'Documento sem título';

    return {
        documentId,
        documentTitle,
        expirationDate,
        daysUntilExpiration,
        urgencyLevel
    };
}

/**
 * Gerar alertas inteligentes baseados no conteúdo do documento
 */
export async function generateSmartAlerts(
    documentId: string,
    metadata: DocumentMetadata,
    companyId: string,
    userId?: string
): Promise<SmartAlert[]> {
    const alerts: SmartAlert[] = [];

    // Alerta de expiração
    if (metadata.expirationDate) {
        const expirationInfo = await detectExpirations(documentId);
        if (expirationInfo) {
            const alert: SmartAlert = {
                type: 'expiration',
                priority: expirationInfo.urgencyLevel,
                title: `Documento vencendo em ${expirationInfo.daysUntilExpiration} dias`,
                message: `O documento "${expirationInfo.documentTitle}" vence em ${expirationInfo.expirationDate.toLocaleDateString('pt-BR')}. ${expirationInfo.daysUntilExpiration <= 7 ? 'ATENÇÃO: Prazo urgente!' : 'Considere renovar ou tomar ação.'
                    }`,
                documentId,
                triggerDate: new Date()
            };

            alerts.push(alert);
            await createAlert(alert, companyId, userId);
        }
    }

    // Alerta de documento sem categoria
    if (!metadata.documentCategory || metadata.documentCategory === 'Outros') {
        const alert: SmartAlert = {
            type: 'classification',
            priority: 'low',
            title: 'Documento precisa de classificação',
            message: 'Este documento não foi categorizado corretamente. Considere adicionar tipo e tags apropriadas.',
            documentId
        };

        alerts.push(alert);
        await createAlert(alert, companyId, userId);
    }

    // Alerta de baixa confiança na extração
    if (metadata.confidence < 0.6) {
        const alert: SmartAlert = {
            type: 'low_confidence',
            priority: 'medium',
            title: 'Revisão manual recomendada',
            message: `A análise automática teve baixa confiança (${(metadata.confidence * 100).toFixed(0)}%). Recomendamos revisar manualmente as informações extraídas.`,
            documentId
        };

        alerts.push(alert);
        await createAlert(alert, companyId, userId);
    }

    return alerts;
}

/**
 * Sugerir tags para o documento
 */
export async function suggestTags(documentId: string): Promise<TagSuggestion[]> {
    const text = await getDocumentText(documentId);

    const prompt = `
Analise o seguinte documento e sugira 5-8 tags relevantes para facilitar a busca e organização.

As tags devem ser:
- Específicas e relevantes ao conteúdo
- Em português
- Curtas (1-3 palavras)
- Úteis para categorização

Responda APENAS em formato JSON:
{
  "tags": [
    {"tag": "nome da tag", "confidence": 0.0-1.0, "reason": "breve justificativa"}
  ]
}

Texto do documento:
${text.substring(0, 2000)}
`.trim();

    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{"tags":[]}');
    return result.tags || [];
}

/**
 * Gerar resumo executivo do documento
 */
export async function summarizeDocument(documentId: string): Promise<DocumentSummary> {
    const text = await getDocumentText(documentId);

    const prompt = `
Crie um resumo executivo profissional do seguinte documento.

Inclua:
1. Resumo geral (2-3 frases)
2. Pontos-chave principais (lista)
3. Itens de ação necessários (se aplicável)
4. Avisos ou pontos de atenção (se aplicável)

Responda APENAS em formato JSON:
{
  "summary": "resumo geral",
  "keyPoints": ["ponto 1", "ponto 2", ...],
  "actionItems": ["ação 1", "ação 2", ...],
  "warnings": ["aviso 1", "aviso 2", ...],
  "confidence": 0.0-1.0
}

Texto do documento:
${text.substring(0, 4000)}
`.trim();

    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    return {
        summary: result.summary || 'Resumo não disponível',
        keyPoints: result.keyPoints || [],
        actionItems: result.actionItems || [],
        warnings: result.warnings || [],
        confidence: result.confidence || 0.7
    };
}

/**
 * FUNÇÃO PRINCIPAL: Análise completa do documento no upload
 */
export async function analyzeDocumentOnUpload(
    documentId: string,
    companyId: string,
    userId?: string
): Promise<DocumentMetadata> {
    console.log(`[Proactive] Starting analysis for document ${documentId}`);

    try {
        // 1. Obter texto do documento
        const text = await getDocumentText(documentId);

        if (!text || text.length < 50) {
            console.warn('[Proactive] Document text too short, skipping analysis');
            return {
                documentId,
                extractedData: {},
                confidence: 0
            };
        }

        // 2. Detectar tipo e categoria
        const typeInfo = await detectDocumentType(text);

        // 3. Detectar datas
        const expirationInfo = await detectExpirations(documentId);

        // 4. Extrair metadados adicionais
        const metadataPrompt = `
Extraia informações estruturadas do documento:
- Partes envolvidas (pessoas, empresas)
- Valores monetários
- Termos e condições importantes
- Obrigações principais

Responda em formato JSON.

Texto:
${text.substring(0, 3000)}
    `.trim();

        const metadataCompletion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [{ role: 'user', content: metadataPrompt }],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const extractedData = JSON.parse(metadataCompletion.choices[0]?.message?.content || '{}');

        // 5. Construir objeto de metadata
        const metadata: DocumentMetadata = {
            documentId,
            documentType: typeInfo.documentType,
            documentCategory: typeInfo.documentCategory,
            issueDate: expirationInfo ? new Date() : undefined,
            expirationDate: expirationInfo?.expirationDate,
            extractedData,
            confidence: typeInfo.confidence
        };

        // 6. Salvar metadados no banco
        await saveExtractedMetadata(documentId, {
            documentType: metadata.documentType,
            documentCategory: metadata.documentCategory,
            expirationDate: metadata.expirationDate?.toISOString(),
            ...extractedData,
            confidence: metadata.confidence
        });

        // 7. Atualizar tabela Documents com categoria e data de expiração
        const pool = await getPool();
        await pool
            .request()
            .input('documentId', sql.UniqueIdentifier, documentId)
            .input('documentCategory', sql.NVarChar(100), metadata.documentCategory)
            .input('expirationDate', sql.DateTime2, metadata.expirationDate || null)
            .query(`
        UPDATE Documents
        SET DocumentCategory = @documentCategory,
            ExpirationDate = @expirationDate
        WHERE DocumentID = @documentId
      `);

        // 8. Gerar alertas inteligentes
        await generateSmartAlerts(documentId, metadata, companyId, userId);

        // 9. Sugerir e aplicar tags
        const tagSuggestions = await suggestTags(documentId);
        for (const tagSugg of tagSuggestions.slice(0, 5)) {
            // Máximo 5 tags
            const tagId = randomUUID();
            await pool
                .request()
                .input('tagId', sql.UniqueIdentifier, tagId)
                .input('documentId', sql.UniqueIdentifier, documentId)
                .input('tag', sql.NVarChar(100), tagSugg.tag)
                .input('createdBy', sql.UniqueIdentifier, userId || null)
                .query(`
          INSERT INTO DocumentTags (TagID, DocumentID, Tag, CreatedBy)
          VALUES (@tagId, @documentId, @tag, @createdBy)
        `);
        }

        console.log(`[Proactive] ✅ Analysis complete for document ${documentId}`);
        console.log(`  - Type: ${metadata.documentType}`);
        console.log(`  - Category: ${metadata.documentCategory}`);
        console.log(`  - Expiration: ${metadata.expirationDate?.toLocaleDateString('pt-BR') || 'N/A'}`);
        console.log(`  - Tags: ${tagSuggestions.map(t => t.tag).join(', ')}`);

        return metadata;
    } catch (error) {
        console.error('[Proactive] Error analyzing document:', error);
        throw error;
    }
}
