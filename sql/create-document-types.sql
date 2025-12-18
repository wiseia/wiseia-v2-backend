-- ============================================
-- WiseIA - Tabela de Tipos de Documentos
-- Database: wiseia_Antigravity
-- ============================================

USE wiseia_Antigravity;
GO

-- Criar tabela DocumentTypes
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DocumentTypes')
BEGIN
    CREATE TABLE DocumentTypes (
        TypeID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        CompanyID UNIQUEIDENTIFIER NOT NULL REFERENCES Companies(CompanyID),
        Name NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500),
        Icon NVARCHAR(50) DEFAULT 'FileText', -- Nome do ícone Lucide
        Color NVARCHAR(7) DEFAULT '#4f46e5', -- Cor em hex
        DefaultTags NVARCHAR(MAX), -- JSON array de tags padrão
        Active BIT DEFAULT 1,
        CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER REFERENCES Users(UserID),
        UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
        UpdatedBy UNIQUEIDENTIFIER REFERENCES Users(UserID)
    );
    
    CREATE INDEX IX_DocumentTypes_CompanyID ON DocumentTypes(CompanyID);
    CREATE INDEX IX_DocumentTypes_Active ON DocumentTypes(Active);
    
    PRINT '✅ Tabela DocumentTypes criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela DocumentTypes já existe';
END
GO

-- Adicionar colunas na tabela Documents (se não existirem)
IF NOT EXISTS (SELECT * FROM sys.columns 
               WHERE object_id = OBJECT_ID('Documents') AND name = 'DocumentTypeID')
BEGIN
    ALTER TABLE Documents 
    ADD DocumentTypeID UNIQUEIDENTIFIER REFERENCES DocumentTypes(TypeID);
    
    PRINT '✅ Coluna DocumentTypeID adicionada em Documents';
END
ELSE
BEGIN
    PRINT '⚠️ Coluna DocumentTypeID já existe em Documents';
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns 
               WHERE object_id = OBJECT_ID('Documents') AND name = 'Tags')
BEGIN
    ALTER TABLE Documents 
    ADD Tags NVARCHAR(MAX); -- JSON array de tags
    
    PRINT '✅ Coluna Tags adicionada em Documents';
END
ELSE
BEGIN
    PRINT '⚠️ Coluna Tags já existe em Documents';
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns 
               WHERE object_id = OBJECT_ID('Documents') AND name = 'MetadataHeader')
BEGIN
    ALTER TABLE Documents 
    ADD MetadataHeader NVARCHAR(MAX); -- Header de metadados injetado
    
    PRINT '✅ Coluna MetadataHeader adicionada em Documents';
END
ELSE
BEGIN
    PRINT '⚠️ Coluna MetadataHeader já existe em Documents';
END
GO

PRINT '';
PRINT '=========================================';
PRINT '✅ Estrutura de tipos de documentos criada!';
PRINT 'Próximo passo: Executar insert-document-types.sql';
PRINT '=========================================';
