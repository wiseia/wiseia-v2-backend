-- ============================================
-- WiseIA - Inserir Departamentos e Divisões para KM CARGO
-- Database: wiseia_Antigravity
-- ============================================

USE wiseia_Antigravity;
GO

DECLARE @CompanyID UNIQUEIDENTIFIER;
DECLARE @ComercialDeptID UNIQUEIDENTIFIER;
DECLARE @OperacionalDeptID UNIQUEIDENTIFIER;
DECLARE @AdministrativoDeptID UNIQUEIDENTIFIER;
DECLARE @CargaAereaDivID UNIQUEIDENTIFIER;
DECLARE @EmissaoDivID UNIQUEIDENTIFIER;
DECLARE @ExpedicaoDivID UNIQUEIDENTIFIER;
DECLARE @RHDivID UNIQUEIDENTIFIER;
DECLARE @FinanceiroDivID UNIQUEIDENTIFIER;

-- Obter CompanyID da KM CARGO
SELECT @CompanyID = CompanyID FROM Companies WHERE TradeName = 'KM CARGO';

IF @CompanyID IS NULL
BEGIN
    PRINT '❌ ERRO: KM CARGO não encontrada!';
    RETURN;
END

PRINT '🏢 Empresa: KM CARGO';
PRINT '📋 Criando estrutura de Departamentos e Divisões...';
PRINT '';

-- ============================================
-- 1. DEPARTAMENTO COMERCIAL
-- ============================================
IF NOT EXISTS (SELECT * FROM Departments WHERE CompanyID = @CompanyID AND Name = 'Comercial')
BEGIN
    SET @ComercialDeptID = NEWID();
    INSERT INTO Departments (DepartmentID, CompanyID, Name, Description, Active)
    VALUES (
        @ComercialDeptID,
        @CompanyID,
        'Comercial',
        'Vendas e relacionamento com clientes',
        1
    );
    PRINT '✅ Departamento COMERCIAL criado';
END
ELSE
BEGIN
    SELECT @ComercialDeptID = DepartmentID FROM Departments WHERE CompanyID = @CompanyID AND Name = 'Comercial';
    PRINT '⚠️ Departamento COMERCIAL já existe';
END

-- Divisão: Carga Aérea (dentro de Comercial)
IF NOT EXISTS (SELECT * FROM Divisions WHERE DepartmentID = @ComercialDeptID AND Name = 'Carga Aérea')
BEGIN
    SET @CargaAereaDivID = NEWID();
    INSERT INTO Divisions (DivisionID, DepartmentID, Name, Description, Active)
    VALUES (
        @CargaAereaDivID,
        @ComercialDeptID,
        'Carga Aérea',
        'Vendas especializadas em transporte aéreo de cargas',
        1
    );
    PRINT '  ↳ ✅ Divisão CARGA AÉREA criada';
END
ELSE
BEGIN
    SELECT @CargaAereaDivID = DivisionID FROM Divisions WHERE DepartmentID = @ComercialDeptID AND Name = 'Carga Aérea';
    PRINT '  ↳ ⚠️ Divisão CARGA AÉREA já existe';
END

-- ============================================
-- 2. DEPARTAMENTO OPERACIONAL
-- ============================================
IF NOT EXISTS (SELECT * FROM Departments WHERE CompanyID = @CompanyID AND Name = 'Operacional')
BEGIN
    SET @OperacionalDeptID = NEWID();
    INSERT INTO Departments (DepartmentID, CompanyID, Name, Description, Active)
    VALUES (
        @OperacionalDeptID,
        @CompanyID,
        'Operacional',
        'Logística e processos operacionais',
        1
    );
    PRINT '✅ Departamento OPERACIONAL criado';
END
ELSE
BEGIN
    SELECT @OperacionalDeptID = DepartmentID FROM Departments WHERE CompanyID = @CompanyID AND Name = 'Operacional';
    PRINT '⚠️ Departamento OPERACIONAL já existe';
END

-- Divisão: Emissão (dentro de Operacional)
IF NOT EXISTS (SELECT * FROM Divisions WHERE DepartmentID = @OperacionalDeptID AND Name = 'Emissão')
BEGIN
    SET @EmissaoDivID = NEWID();
    INSERT INTO Divisions (DivisionID, DepartmentID, Name, Description, Active)
    VALUES (
        @EmissaoDivID,
        @OperacionalDeptID,
        'Emissão',
        'Emissão de documentações de transporte',
        1
    );
    PRINT '  ↳ ✅ Divisão EMISSÃO criada';
END
ELSE
BEGIN
    SELECT @EmissaoDivID = DivisionID FROM Divisions WHERE DepartmentID = @OperacionalDeptID AND Name = 'Emissão';
    PRINT '  ↳ ⚠️ Divisão EMISSÃO já existe';
END

-- Divisão: Expedição (dentro de Operacional)
IF NOT EXISTS (SELECT * FROM Divisions WHERE DepartmentID = @OperacionalDeptID AND Name = 'Expedição')
BEGIN
    SET @ExpedicaoDivID = NEWID();
    INSERT INTO Divisions (DivisionID, DepartmentID, Name, Description, Active)
    VALUES (
        @ExpedicaoDivID,
        @OperacionalDeptID,
        'Expedição',
        'Expedição e despacho de cargas',
        1
    );
    PRINT '  ↳ ✅ Divisão EXPEDIÇÃO criada';
END
ELSE
BEGIN
    SELECT @ExpedicaoDivID = DivisionID FROM Divisions WHERE DepartmentID = @OperacionalDeptID AND Name = 'Expedição';
    PRINT '  ↳ ⚠️ Divisão EXPEDIÇÃO já existe';
END

-- ============================================
-- 3. DEPARTAMENTO ADMINISTRATIVO
-- ============================================
IF NOT EXISTS (SELECT * FROM Departments WHERE CompanyID = @CompanyID AND Name = 'Administrativo')
BEGIN
    SET @AdministrativoDeptID = NEWID();
    INSERT INTO Departments (DepartmentID, CompanyID, Name, Description, Active)
    VALUES (
        @AdministrativoDeptID,
        @CompanyID,
        'Administrativo',
        'Recursos humanos, financeiro e suporte administrativo',
        1
    );
    PRINT '✅ Departamento ADMINISTRATIVO criado';
END
ELSE
BEGIN
    SELECT @AdministrativoDeptID = DepartmentID FROM Departments WHERE CompanyID = @CompanyID AND Name = 'Administrativo';
    PRINT '⚠️ Departamento ADMINISTRATIVO já existe';
END

-- Divisão: RH (dentro de Administrativo)
IF NOT EXISTS (SELECT * FROM Divisions WHERE DepartmentID = @AdministrativoDeptID AND Name = 'RH')
BEGIN
    SET @RHDivID = NEWID();
    INSERT INTO Divisions (DivisionID, DepartmentID, Name, Description, Active)
    VALUES (
        @RHDivID,
        @AdministrativoDeptID,
        'RH',
        'Recursos Humanos - recrutamento, treinamento e gestão de pessoas',
        1
    );
    PRINT '  ↳ ✅ Divisão RH criada';
END
ELSE
BEGIN
    SELECT @RHDivID = DivisionID FROM Divisions WHERE DepartmentID = @AdministrativoDeptID AND Name = 'RH';
    PRINT '  ↳ ⚠️ Divisão RH já existe';
END

-- Divisão: Financeiro (dentro de Administrativo)
IF NOT EXISTS (SELECT * FROM Divisions WHERE DepartmentID = @AdministrativoDeptID AND Name = 'Financeiro')
BEGIN
    SET @FinanceiroDivID = NEWID();
    INSERT INTO Divisions (DivisionID, DepartmentID, Name, Description, Active)
    VALUES (
        @FinanceiroDivID,
        @AdministrativoDeptID,
        'Financeiro',
        'Gestão financeira, contas a pagar e receber',
        1
    );
    PRINT '  ↳ ✅ Divisão FINANCEIRO criada';
END
ELSE
BEGIN
    SELECT @FinanceiroDivID = DivisionID FROM Divisions WHERE DepartmentID = @AdministrativoDeptID AND Name = 'Financeiro';
    PRINT '  ↳ ⚠️ Divisão FINANCEIRO já existe';
END

PRINT '';
PRINT '=========================================';
PRINT '👥 Associando usuários aos departamentos...';
PRINT '=========================================';

-- ============================================
-- 4. ASSOCIAR USUÁRIOS AOS DEPARTAMENTOS/DIVISÕES
-- ============================================

-- Ulisses - Manager (gerente geral, sem divisão específica - vê tudo)
UPDATE Users 
SET Position = 'Manager',
    DepartmentID = NULL,  -- Manager geral não tem departamento específico
    DivisionID = NULL
WHERE Email = 'ulisses@kmcargoteste.com.br';
PRINT '✅ Ulisses - Manager (visão geral de toda empresa)';

-- Graziotin - Manager Comercial (departamento Comercial, sem divisão específica)
UPDATE Users 
SET Position = 'Manager Comercial',
    DepartmentID = @ComercialDeptID,
    DivisionID = NULL  -- Manager de departamento vê todas as divisões
WHERE Email = 'graziotin@kmcargoteste.com.br';
PRINT '✅ Graziotin - Manager Comercial';

-- Isabella - Coordenadora Carga Aérea (divisão Carga Aérea)
UPDATE Users 
SET Position = 'Coordenadora',
    DepartmentID = @ComercialDeptID,
    DivisionID = @CargaAereaDivID
WHERE Email = 'isabella@kmcargoteste.com.br';
PRINT '  ↳ ✅ Isabella - Coordenadora Carga Aérea';

-- André - Vendedor Carga Aérea (divisão Carga Aérea)
UPDATE Users 
SET Position = 'Vendedor',
    DepartmentID = @ComercialDeptID,
    DivisionID = @CargaAereaDivID
WHERE Email = 'andre@kmcargoteste.com.br';
PRINT '  ↳ ✅ André - Vendedor Carga Aérea';

PRINT '';
PRINT '=========================================';
PRINT '📊 Resumo da Estrutura Criada';
PRINT '=========================================';

-- Mostrar resumo
SELECT 
    d.Name as Departamento,
    div.Name as Divisao,
    u.FullName as Usuario,
    u.Position as Cargo,
    u.Email
FROM Departments d
LEFT JOIN Divisions div ON div.DepartmentID = d.DepartmentID
LEFT JOIN Users u ON (u.DepartmentID = d.DepartmentID AND (u.DivisionID = div.DivisionID OR (u.DivisionID IS NULL AND div.DivisionID IS NULL)))
WHERE d.CompanyID = @CompanyID
ORDER BY d.Name, div.Name, u.Position DESC, u.FullName;

-- Mostrar Manager geral
SELECT 
    'MANAGER GERAL' as Departamento,
    NULL as Divisao,
    FullName as Usuario,
    Position as Cargo,
    Email
FROM Users
WHERE Email = 'ulisses@kmcargoteste.com.br';

PRINT '';
PRINT '=========================================';
PRINT '✅ CONCLUÍDO! Estrutura hierárquica completa.';
PRINT '=========================================';
