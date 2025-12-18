// src/routes/meRoutes.ts
import type { FastifyInstance } from 'fastify';
import { getPool, sql } from '../db.js';

export async function meRoutes(app: FastifyInstance) {
    app.get('/me', async (request: any, reply: any) => {
        try {
            // Extract token from Authorization header
            const authHeader = request.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return reply.status(401).send({ error: 'Não autenticado' });
            }

            const token = authHeader.substring(7); // Remove "Bearer "

            // Decode JWT to get user ID
            let decoded: any;
            try {
                const jwt = await import('jsonwebtoken');
                const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
                decoded = jwt.default.verify(token, JWT_SECRET);
            } catch (err) {
                return reply.status(401).send({ error: 'Token inválido' });
            }

            const userId = decoded.sub;

            if (!userId) {
                return reply.status(401).send({ error: 'Token inválido - sem user ID' });
            }

            const pool = await getPool();

            const result = await pool
                .request()
                .input('userId', sql.UniqueIdentifier, userId)
                .query(`
          SELECT 
            u.UserID as idUsuario,
            u.FullName as nome,
            u.Email as email,
            u.Position as cargo,
            u.CompanyID as idEmpresa,
            u.DepartmentID as idDepartamento,
            u.DivisionID as idDivisao,
            u.IsAdmin as isAdm,
            c.Name as empresaNome,
            c.TradeName as empresaTradeName,
            dept.Name as departamentoNome,
            div.Name as divisaoNome
          FROM Users u
          LEFT JOIN Companies c ON c.CompanyID = u.CompanyID
          LEFT JOIN Departments dept ON dept.DepartmentID = u.DepartmentID
          LEFT JOIN Divisions div ON div.DivisionID = u.DivisionID
          WHERE u.UserID = @userId AND u.Active = 1
        `);

            if (result.recordset.length === 0) {
                return reply.status(404).send({ error: 'Usuário não encontrado' });
            }

            const user = result.recordset[0];

            return reply.send({
                idUsuario: user.idUsuario,
                nome: user.nome,
                email: user.email,
                cargo: user.cargo,
                idEmpresa: user.idEmpresa,
                idDepartamento: user.idDepartamento,
                idDivisao: user.idDivisao,
                isAdm: user.isAdm,
                role: user.isAdm ? 'ADMIN' : 'USER',
                empresa: user.empresaNome ? {
                    nome: user.empresaNome,
                    tradeName: user.empresaTradeName
                } : null,
                departamento: user.departamentoNome || null,
                divisao: user.divisaoNome || null
            });
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            app.log.error(`Erro ao buscar dados do usuário: ${errorMsg}`);
            return reply.status(500).send({ error: 'Erro interno do servidor' });
        }
    });
}
