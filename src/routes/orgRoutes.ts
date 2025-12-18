// src/routes/orgRoutes.ts
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { getPool, sql } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

type RoleCode =
  | 'SUPER_ADMIN'
  | 'MASTER'
  | 'MANAGER'
  | 'COORDINATOR'
  | 'USER'
  | string;

interface DecodedToken {
  sub: number;
  email: string;
  role: RoleCode;
  roleName?: string;
  companyId: number | null;
  departmentId: number | null;
  divisionId: number | null;
  iat?: number;
  exp?: number;
}

function getAuthFromRequest(request: any): DecodedToken {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Token não informado');
  }

  const token = authHeader.replace('Bearer ', '').trim();

  // 👇 Aqui é onde ajustamos: passamos por 'unknown' antes de forçar pra DecodedToken
  const raw = jwt.verify(token, JWT_SECRET) as unknown as DecodedToken;

  // normaliza o role para nosso padrão interno
  const rawRole = (raw.role ?? '') as string;
  const roleNorm = rawRole.replace(/\s+/g, '_').toUpperCase() as RoleCode;

  return {
    ...raw,
    role: roleNorm,
  };
}

export async function orgRoutes(app: FastifyInstance) {
  // Lista departamentos da empresa
  app.get('/companies/:companyId/departments', async (request: any, reply: any) => {
    try {
      const auth = getAuthFromRequest(request);
      const requestedCompanyId = parseInt(request.params.companyId, 10);

      if (isNaN(requestedCompanyId)) {
        return reply.status(400).send({ error: 'companyId inválido' });
      }

      // SUPER_ADMIN pode ver estrutura de qualquer empresa (não documentos)
      if (auth.role !== 'SUPER_ADMIN') {
        if (!auth.companyId || auth.companyId !== requestedCompanyId) {
          return reply
            .status(403)
            .send({ error: 'Você não tem permissão para acessar esta empresa' });
        }
      }

      const pool = await getPool();
      const result = await pool
        .request()
        .input('companyId', sql.Int, requestedCompanyId)
        .query(`
          SELECT 
            DepartmentId,
            CompanyId,
            Name,
            Code,
            IsActive,
            CreatedAt,
            UpdatedAt
          FROM Departments
          WHERE CompanyId = @companyId
          ORDER BY Name
        `);

      return reply.send({
        companyId: requestedCompanyId,
        departments: result.recordset,
      });
    } catch (err: any) {
      app.log.error({ err }, '[ORG] Erro ao listar departamentos');
      if (err.message === 'Token não informado' || err.name === 'JsonWebTokenError') {
        return reply.status(401).send({ error: 'Token inválido ou não informado' });
      }
      return reply.status(500).send({ error: 'Erro ao listar departamentos' });
    }
  });

  // Lista divisões da empresa
  app.get('/companies/:companyId/divisions', async (request: any, reply: any) => {
    try {
      const auth = getAuthFromRequest(request);
      const requestedCompanyId = parseInt(request.params.companyId, 10);

      if (isNaN(requestedCompanyId)) {
        return reply.status(400).send({ error: 'companyId inválido' });
      }

      if (auth.role !== 'SUPER_ADMIN') {
        if (!auth.companyId || auth.companyId !== requestedCompanyId) {
          return reply
            .status(403)
            .send({ error: 'Você não tem permissão para acessar esta empresa' });
        }
      }

      const pool = await getPool();
      const result = await pool
        .request()
        .input('companyId', sql.Int, requestedCompanyId)
        .query(`
          SELECT 
            DivisionId,
            CompanyId,
            DepartmentId,
            Name,
            Code,
            IsActive,
            CreatedAt,
            UpdatedAt
          FROM Divisions
          WHERE CompanyId = @companyId
          ORDER BY Name
        `);

      return reply.send({
        companyId: requestedCompanyId,
        divisions: result.recordset,
      });
    } catch (err: any) {
      app.log.error({ err }, '[ORG] Erro ao listar divisões');
      if (err.message === 'Token não informado' || err.name === 'JsonWebTokenError') {
        return reply.status(401).send({ error: 'Token inválido ou não informado' });
      }
      return reply.status(500).send({ error: 'Erro ao listar divisões' });
    }
  });

  // Lista usuários da empresa (sem senha)
  app.get('/companies/:companyId/users', async (request: any, reply: any) => {
    try {
      const auth = getAuthFromRequest(request);
      const requestedCompanyId = parseInt(request.params.companyId, 10);

      if (isNaN(requestedCompanyId)) {
        return reply.status(400).send({ error: 'companyId inválido' });
      }

      if (auth.role !== 'SUPER_ADMIN') {
        if (!auth.companyId || auth.companyId !== requestedCompanyId) {
          return reply
            .status(403)
            .send({ error: 'Você não tem permissão para acessar esta empresa' });
        }
      }

      const pool = await getPool();
      const result = await pool
        .request()
        .input('companyId', sql.Int, requestedCompanyId)
        .query(`
          SELECT 
            u.UserId,
            u.Name,
            u.Email,
            u.CompanyId,
            u.DepartmentId,
            u.DivisionId,
            u.IsActive,
            u.CreatedAt,
            u.UpdatedAt,
            r.Code AS RoleCode,
            r.Name AS RoleName
          FROM Users u
          INNER JOIN Roles r ON r.RoleId = u.RoleId
          WHERE u.CompanyId = @companyId
          ORDER BY u.Name
        `);

      return reply.send({
        companyId: requestedCompanyId,
        users: result.recordset,
      });
    } catch (err: any) {
      app.log.error({ err }, '[ORG] Erro ao listar usuários');
      if (err.message === 'Token não informado' || err.name === 'JsonWebTokenError') {
        return reply.status(401).send({ error: 'Token inválido ou não informado' });
      }
      return reply.status(500).send({ error: 'Erro ao listar usuários' });
    }
  });
}
