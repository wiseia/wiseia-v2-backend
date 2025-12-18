-- ============================================
-- WiseIA - Estrutura Hierárquica de Departamentos e Divisões
-- Database: wiseia_Antigravity
-- ============================================

USE wiseia_Antigravity;
GO

-- 1. Criar tabela Departments
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Departments')
BEGIN
    CREATE TABLE Departments (
        DepartmentID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        CompanyID UNIQUEIDENTIFIER NOT NULL REFERENCES Companies(CompanyID),
        Name NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500),
        Active BIT DEFAULT 1,
        CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER REFERENCES Users(UserID),
        UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
        UpdatedBy UNIQUEIDENTIFIER REFERENCES Users(UserID)
    );
    CREATE INDEX IX_Departments_CompanyID ON Departments(CompanyID);
    PRINT '✅ Table Departments created';
END
ELSE
BEGIN
    PRINT '⚠️ Table Departments already exists';
END
GO

-- 2. Criar tabela Divisions (subordinada a Departments)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Divisions')
BEGIN
    CREATE TABLE Divisions (
        DivisionID UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        DepartmentID UNIQUEIDENTIFIER NOT NULL REFERENCES Departments(DepartmentID),
        Name NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500),
        Active BIT DEFAULT 1,
        CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER REFERENCES Users(UserID),
        UpdatedAt DATETIME2 DEFAULT GETUTCDATE(),
        UpdatedBy UNIQUEIDENTIFIER REFERENCES Users(UserID)
    );
    CREATE INDEX IX_Divisions_DepartmentID ON Divisions(DepartmentID);
    PRINT '✅ Table Divisions created';
END
ELSE
BEGIN
    PRINT '⚠️ Table Divisions already exists';
END
GO

-- 3. Adicionar colunas DepartmentID e DivisionID na tabela Users (se não existirem)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'DepartmentID')
BEGIN
    ALTER TABLE Users ADD DepartmentID UNIQUEIDENTIFIER REFERENCES Departments(DepartmentID);
    PRINT '✅ Column DepartmentID added to Users table';
END
ELSE
BEGIN
    PRINT '⚠️ Column DepartmentID already exists in Users table';
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'DivisionID')
BEGIN
    ALTER TABLE Users ADD DivisionID UNIQUEIDENTIFIER REFERENCES Divisions(DivisionID);
    PRINT '✅ Column DivisionID added to Users table';
END
ELSE
BEGIN
    PRINT '⚠️ Column DivisionID already exists in Users table';
END
GO

-- 4. Adicionar coluna Position (cargo) naUsers table (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Position')
BEGIN
    ALTER TABLE Users ADD Position NVARCHAR(100);
    PRINT '✅ Column Position added to Users table';
END
ELSE
BEGIN
    PRINT '⚠️ Column Position already exists in Users table';
END
GO

PRINT '';
PRINT '=========================================';
PRINT '✅ Estrutura hierárquica criada com sucesso!';
PRINT 'Próximo passo: Executar insert-departments-divisions.sql';
PRINT '=========================================';
