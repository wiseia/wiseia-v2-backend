-- ============================================
-- Migration: Add Proactive Analysis Columns
-- Database: wiseia_Antigravity
-- Date: 2025-12-16
-- ============================================

USE wiseia_Antigravity;
GO

PRINT 'Starting migration: Add proactive analysis columns...';
GO

-- Adicionar colunas para análise proativa na tabela Documents
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'Documents') 
    AND name = 'ExpirationDate'
)
BEGIN
    ALTER TABLE Documents
    ADD ExpirationDate DATETIME2;
    
    PRINT '✓ Added ExpirationDate column to Documents';
END
ELSE
BEGIN
    PRINT '- ExpirationDate column already exists';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'Documents') 
    AND name = 'IssueDate'
)
BEGIN
    ALTER TABLE Documents
    ADD IssueDate DATETIME2;
    
    PRINT '✓ Added IssueDate column to Documents';
END
ELSE
BEGIN
    PRINT '- IssueDate column already exists';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'Documents') 
    AND name = 'DocumentCategory'
)
BEGIN
    ALTER TABLE Documents
    ADD DocumentCategory NVARCHAR(100);
    
    PRINT '✓ Added DocumentCategory column to Documents';
END
ELSE
BEGIN
    PRINT '- DocumentCategory column already exists';
END
GO

-- Criar índices para melhor performance nas buscas
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'IX_Documents_ExpirationDate' 
    AND object_id = OBJECT_ID('Documents')
)
BEGIN
    CREATE INDEX IX_Documents_ExpirationDate 
    ON Documents(ExpirationDate)
    WHERE ExpirationDate IS NOT NULL;
    
    PRINT '✓ Created index IX_Documents_ExpirationDate';
END
ELSE
BEGIN
    PRINT '- Index IX_Documents_ExpirationDate already exists';
END
GO

IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'IX_Documents_DocumentCategory' 
    AND object_id = OBJECT_ID('Documents')
)
BEGIN
    CREATE INDEX IX_Documents_DocumentCategory 
    ON Documents(DocumentCategory)
    WHERE DocumentCategory IS NOT NULL;
    
    PRINT '✓ Created index IX_Documents_DocumentCategory';
END
ELSE
BEGIN
    PRINT '- Index IX_Documents_DocumentCategory already exists';
END
GO

-- Verificar se a tabela ChunkEmbeddings existe e tem a coluna Embedding
-- (Necessário para o RAG service)
IF NOT EXISTS (
    SELECT * FROM sys.tables 
    WHERE name = 'ChunkEmbeddings'
)
BEGIN
    PRINT '⚠️ WARNING: ChunkEmbeddings table does not exist!';
    PRINT '   Creating ChunkEmbeddings table...';
    
    CREATE TABLE ChunkEmbeddings (
        EmbeddingID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        ChunkID UNIQUEIDENTIFIER NOT NULL REFERENCES DocumentChunks(ChunkID) ON DELETE CASCADE,
        Embedding NVARCHAR(MAX) NOT NULL, -- JSON string of embedding vector
        Model NVARCHAR(100) DEFAULT 'text-embedding-3-small',
        CreatedAt DATETIME2 DEFAULT GETUTCDATE()
    );
    
    CREATE INDEX IX_ChunkEmbeddings_ChunkID ON ChunkEmbeddings(ChunkID);
    
    PRINT '✓ Created ChunkEmbeddings table';
END
ELSE
BEGIN
    PRINT '- ChunkEmbeddings table already exists';
END
GO

PRINT '';
PRINT '✅ Migration completed successfully!';
PRINT '';
PRINT 'Summary:';
PRINT '- ExpirationDate: For tracking document expiration dates';
PRINT '- IssueDate: For tracking document issue/creation dates';
PRINT '- DocumentCategory: For AI-detected document categories';
PRINT '- Indexes created for optimized queries';
PRINT '';
PRINT 'Next steps:';
PRINT '1. Deploy this migration to your database';
PRINT '2. Test the proactive analyzer with a sample document';
PRINT '3. Check ExtractedMetadata table for extracted data';
PRINT '4. Monitor Alerts table for generated alerts';
GO
