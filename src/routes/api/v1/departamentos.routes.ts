// src/routes/api/v1/departamentos.routes.ts
import { FastifyPluginAsync } from 'fastify';
import { getPool, sql } from '../../../db.js';

export const departamentosV1Routes: FastifyPluginAsync = async (app) => {
    /**
     * POST /api/v1/departamentos
     * Cria um novo departamento
     */
    app.post(
        '/departamentos',
        {
            preHandler: [(app as any).authenticate],
        },
        async (req: any, reply) => {
            const { nome, descricao, ativo } = req.body || {};

            if (!nome || !nome.trim()) {
                return reply.code(400).send({ error: 'nome é obrigatório' });
            }

            const pool = await getPool();
            const companyId = req.user.companyId; // Note: using companyId from JWT
            const nameClean = String(nome).trim();
            const descriptionClean = descricao ? String(descricao).trim() : null;
            const activeValue = ativo === false || ativo === 0 ? 0 : 1;

            try {
                // Inserir departamento usando schema INGLÊS do banco
                const result = await pool.request()
                    .input('companyId', sql.VarChar, companyId)
                    .input('name', sql.NVarChar, nameClean)
                    .input('description', sql.NVarChar, descriptionClean)
                    .input('active', sql.Bit, activeValue)
                    .query(`
                        INSERT INTO Departments (CompanyID, Name, Description, Active)
                        OUTPUT INSERTED.DepartmentID, INSERTED.Name, INSERTED.Description, INSERTED.Active
                        VALUES (@companyId, @name, @description, @active)
                    `);

                if (!result.recordset || result.recordset.length === 0) {
                    return reply.code(500).send({ error: 'Falha ao criar departamento' });
                }

                const created = result.recordset[0];

                // Retornar em português para o frontend
                return reply.code(201).send({
                    idDepartamento: created.DepartmentID,
                    idEmpresa: companyId,
                    nome: created.Name,
                    descricao: created.Description,
                    ativo: created.Active,
                });
            } catch (err: any) {
                app.log.error({ err }, 'Erro ao criar departamento');
                return reply.code(500).send({
                    error: 'Erro ao criar departamento',
                    detail: err.message,
                });
            }
        }
    );

    /**
     * GET /api/v1/departamentos
     * Lista departamentos da empresa
     */
    app.get(
        '/departamentos',
        {
            preHandler: [(app as any).authenticate],
        },
        async (req: any, reply) => {
            const pool = await getPool();
            const companyId = req.user.companyId;

            try {
                const result = await pool.request()
                    .input('companyId', sql.VarChar, companyId)
                    .query(`
                        SELECT 
                            DepartmentID,
                            CompanyID,
                            Name,
                            Description,
                            Active,
                            CreatedAt,
                            UpdatedAt
                        FROM Departments
                        WHERE CompanyID = @companyId AND Active = 1
                        ORDER BY Name ASC
                    `);

                // Transformar para português no retorno
                const departments = (result.recordset || []).map((dept: any) => ({
                    idDepartamento: dept.DepartmentID,
                    idEmpresa: dept.CompanyID,
                    nome: dept.Name,
                    descricao: dept.Description,
                    ativo: dept.Active,
                    criadoEmUtc: dept.CreatedAt,
                    atualizadoEmUtc: dept.UpdatedAt
                }));

                return reply.send(departments);
            } catch (err: any) {
                app.log.error({ err }, 'Erro ao listar departamentos');
                return reply.code(500).send({
                    error: 'Erro ao listar departamentos',
                    detail: err.message,
                });
            }
        }
    );

    /**
     * PUT /api/v1/departamentos/:id
     * Atualiza um departamento
     */
    app.put(
        '/departamentos/:id',
        {
            preHandler: [(app as any).authenticate],
        },
        async (req: any, reply) => {
            const departmentId = req.params.id;
            const { nome, descricao, ativo } = req.body || {};
            const pool = await getPool();
            const companyId = req.user.companyId;

            try {
                // Verificar se departamento existe e pertence à empresa
                const checkResult = await pool.request()
                    .input('departmentId', sql.VarChar, departmentId)
                    .input('companyId', sql.VarChar, companyId)
                    .query(`
                        SELECT DepartmentID FROM Departments
                        WHERE DepartmentID = @departmentId AND CompanyID = @companyId
                    `);

                if (!checkResult.recordset || checkResult.recordset.length === 0) {
                    return reply.code(404).send({ error: 'Departamento não encontrado' });
                }

                // Construir UPDATE dinamicamente
                const updates: string[] = [];
                const request = pool.request()
                    .input('departmentId', sql.VarChar, departmentId)
                    .input('companyId', sql.VarChar, companyId);

                if (nome !== undefined && String(nome).trim()) {
                    updates.push('Name = @name');
                    request.input('name', sql.NVarChar, String(nome).trim());
                }
                if (descricao !== undefined) {
                    updates.push('Description = @description');
                    request.input('description', sql.NVarChar, descricao ? String(descricao).trim() : null);
                }
                if (ativo !== undefined) {
                    updates.push('Active = @active');
                    request.input('active', sql.Bit, ativo === false || ativo === 0 ? 0 : 1);
                }

                if (updates.length === 0) {
                    return reply.code(400).send({ error: 'Nada para atualizar' });
                }

                await request.query(`
                    UPDATE Departments
                    SET ${updates.join(', ')}, UpdatedAt = GETUTCDATE()
                    WHERE DepartmentID = @departmentId AND CompanyID = @companyId
                `);

                // Retornar departamento atualizado
                const updatedResult = await pool.request()
                    .input('departmentId', sql.VarChar, departmentId)
                    .input('companyId', sql.VarChar, companyId)
                    .query(`
                        SELECT * FROM Departments
                        WHERE DepartmentID = @departmentId AND CompanyID = @companyId
                    `);

                const dept = updatedResult.recordset[0];
                return reply.send({
                    idDepartamento: dept.DepartmentID,
                    idEmpresa: dept.CompanyID,
                    nome: dept.Name,
                    descricao: dept.Description,
                    ativo: dept.Active
                });
            } catch (err: any) {
                app.log.error({ err }, 'Erro ao atualizar departamento');
                return reply.code(500).send({
                    error: 'Erro ao atualizar departamento',
                    detail: err.message,
                });
            }
        }
    );

    /**
     * DELETE /api/v1/departamentos/:id
     * Remove um departamento
     */
    app.delete(
        '/departamentos/:id',
        {
            preHandler: [(app as any).authenticate],
        },
        async (req: any, reply) => {
            const departmentId = req.params.id;
            const pool = await getPool();
            const companyId = req.user.companyId;

            try {
                const result = await pool.request()
                    .input('departmentId', sql.VarChar, departmentId)
                    .input('companyId', sql.VarChar, companyId)
                    .query(`
                        DELETE FROM Departments
                        WHERE DepartmentID = @departmentId AND CompanyID = @companyId
                    `);

                if (result.rowsAffected[0] === 0) {
                    return reply.code(404).send({ error: 'Departamento não encontrado' });
                }

                return reply.send({ deleted: true });
            } catch (err: any) {
                app.log.error({ err }, 'Erro ao deletar departamento');
                return reply.code(500).send({
                    error: 'Erro ao deletar departamento',
                    detail: err.message,
                });
            }
        }
    );

    /**
     * GET /api/v1/departamentos/:id/divisoes
     * Lista divisões de um departamento específico
     */
    app.get(
        '/departamentos/:id/divisoes',
        {
            preHandler: [(app as any).authenticate],
        },
        async (req: any, reply) => {
            const departmentId = req.params.id;
            const pool = await getPool();

            try {
                const result = await pool.request()
                    .input('departmentId', sql.VarChar, departmentId)
                    .query(`
                        SELECT 
                            DivisionID,
                            DepartmentID,
                            Name,
                            Description,
                            Active
                        FROM Divisions
                        WHERE DepartmentID = @departmentId AND Active = 1
                        ORDER BY Name ASC
                    `);

                // Transformar para português
                const divisions = (result.recordset || []).map((div: any) => ({
                    idDivisao: div.DivisionID,
                    idDepartamento: div.DepartmentID,
                    nome: div.Name,
                    descricao: div.Description,
                    ativo: div.Active
                }));

                return reply.send(divisions);
            } catch (err: any) {
                app.log.error({ err }, 'Erro ao listar divisões');
                return reply.code(500).send({
                    error: 'Erro ao listar divisões',
                    detail: err.message,
                });
            }
        }
    );
};
