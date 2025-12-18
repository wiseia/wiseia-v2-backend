-- ============================================
-- WiseIA - Inserir Tipos de Documentos Padrão
-- Para empresa: KM CARGO
-- ============================================

USE wiseia_Antigravity;
GO

DECLARE @CompanyID UNIQUEIDENTIFIER;
DECLARE @UserID UNIQUEIDENTIFIER;

-- Obter IDs da KM CARGO e Manager (Ulisses)
SELECT @CompanyID = CompanyID FROM Companies WHERE TradeName = 'KM CARGO';
SELECT @UserID = UserID FROM Users WHERE Email = 'ulisses@kmcargoteste.com.br';

IF @CompanyID IS NULL
BEGIN
    PRINT '❌ ERRO: KM CARGO não encontrada!';
    RETURN;
END

PRINT '🏢 Empresa: KM CARGO';
PRINT '👤 Usuário: ' + CAST(@UserID AS NVARCHAR(50));
PRINT '📋 Inserindo tipos de documentos padrão...';
PRINT '';

-- 1. CONTRATO
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Contrato')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Contrato',
        'Contratos comerciais, de prestação de serviços e acordos formais',
        'FileSignature',
        '#10b981',
        '["contrato", "juridico", "acordo"]',
        @UserID
    );
    PRINT '✅ Tipo CONTRATO criado';
END

-- 2. PROPOSTA COMERCIAL
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Proposta Comercial')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Proposta Comercial',
        'Propostas de venda, orçamentos e ofertas comerciais',
        'FileText',
        '#4f46e5',
        '["proposta", "comercial", "vendas", "orcamento"]',
        @UserID
    );
    PRINT '✅ Tipo PROPOSTA COMERCIAL criado';
END

-- 3. NOTA FISCAL
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Nota Fiscal')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Nota Fiscal',
        'Notas fiscais de serviço e produtos',
        'Receipt',
        '#f59e0b',
        '["nota-fiscal", "nf", "fiscal", "faturamento"]',
        @UserID
    );
    PRINT '✅ Tipo NOTA FISCAL criado';
END

-- 4. CERTIFICADO
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Certificado')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Certificado',
        'Certificados de treinamento, conformidade e qualidade',
        'Award',
        '#8b5cf6',
        '["certificado", "certificacao", "compliance"]',
        @UserID
    );
    PRINT '✅ Tipo CERTIFICADO criado';
END

-- 5. MANUAL / PROCEDIMENTO
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Manual/Procedimento')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Manual/Procedimento',
        'Manuais operacionais, procedimentos e instruções de trabalho',
        'Book',
        '#06b6d4',
        '["manual", "procedimento", "processo", "instrucao"]',
        @UserID
    );
    PRINT '✅ Tipo MANUAL/PROCEDIMENTO criado';
END

-- 6. DOCUMENTO RH
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Documento RH')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Documento RH',
        'Documentos de recursos humanos: admissão, desligamento, férias, etc.',
        'Users',
        '#ec4899',
        '["rh", "recursos-humanos", "admissao", "pessoal"]',
        @UserID
    );
    PRINT '✅ Tipo DOCUMENTO RH criado';
END

-- 7. DOCUMENTO OPERACIONAL (Transporte/Logística)
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Documento Operacional')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Documento Operacional',
        'Manifestos, AWB, conhecimentos de transporte e documentos operacionais',
        'Truck',
        '#ef4444',
        '["operacional", "transporte", "logistica", "manifesto", "awb"]',
        @UserID
    );
    PRINT '✅ Tipo DOCUMENTO OPERACIONAL criado';
END

-- 8. RELATÓRIO
IF NOT EXISTS (SELECT * FROM DocumentTypes WHERE CompanyID = @CompanyID AND Name = 'Relatório')
BEGIN
    INSERT INTO DocumentTypes (TypeID, CompanyID, Name, Description, Icon, Color, DefaultTags, CreatedBy)
    VALUES (
        NEWID(),
        @CompanyID,
        'Relatório',
        'Relatórios gerenciais, análises e dashboards',
        'BarChart3',
        '#14b8a6',
        '["relatorio", "analise", "dashboard", "gestao"]',
        @UserID
    );
    PRINT '✅ Tipo RELATÓRIO criado';
END

PRINT '';
PRINT '=========================================';
PRINT '📊 Resumo dos Tipos Criados';
PRINT '=========================================';

SELECT 
    Name as 'Tipo',
    Icon as 'Ícone',
    Color as 'Cor',
    DefaultTags as 'Tags Padrão'
FROM DocumentTypes
WHERE CompanyID = @CompanyID
ORDER BY Name;

PRINT '';
PRINT '✅ CONCLUÍDO! 8 tipos de documentos cadastrados para KM CARGO';
