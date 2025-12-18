// src/routes/aiV2.ts
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

interface AiChatBody {
  question: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

type RoleCode =
  | 'SUPER_ADMIN'
  | 'MASTER'
  | 'MANAGER'
  | 'COORDINATOR'
  | 'USER'
  | string;

interface AccessFilter {
  companyIds?: number[];
  departmentIds?: number[];
  divisionIds?: number[];
  ownerUserId?: number;
  includeSharedViaAccessRules?: boolean;
}

function buildAccessFilter(
  role: RoleCode,
  userId: number,
  companyId: number | null,
  departmentId: number | null,
  divisionId: number | null
): AccessFilter {
  switch (role) {
    case 'MASTER':
      return {
        companyIds: companyId != null ? [companyId] : undefined,
        includeSharedViaAccessRules: true,
      };

    case 'MANAGER':
      return {
        companyIds: companyId != null ? [companyId] : undefined,
        departmentIds: departmentId != null ? [departmentId] : undefined,
        includeSharedViaAccessRules: true,
      };

    case 'COORDINATOR':
      return {
        companyIds: companyId != null ? [companyId] : undefined,
        departmentIds: departmentId != null ? [departmentId] : undefined,
        divisionIds: divisionId != null ? [divisionId] : undefined,
        includeSharedViaAccessRules: true,
      };

    case 'USER':
      return {
        ownerUserId: userId,
        companyIds: companyId != null ? [companyId] : undefined,
        departmentIds: departmentId != null ? [departmentId] : undefined,
        divisionIds: divisionId != null ? [divisionId] : undefined,
        includeSharedViaAccessRules: true,
      };

    default:
      return {
        ownerUserId: userId,
        includeSharedViaAccessRules: true,
      };
  }
}

export async function aiV2Routes(app: FastifyInstance) {
  app.post<{ Body: AiChatBody }>('/chat', async (request: any, reply: any) => {
    try {
      // 1) Pega e valida o token
      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Token não informado' });
      }

      const token = authHeader.replace('Bearer ', '').trim();

      let decoded: any;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        request.log.error({ err }, '[AI V2] Token inválido');
        return reply.status(401).send({ error: 'Token inválido ou expirado' });
      }

      // Normaliza o papel: "Super Admin" -> "SUPER_ADMIN"
      const rawRole = (decoded.role ?? '') as string;
      const role = rawRole.replace(/\s+/g, '_').toUpperCase() as RoleCode;

      // Regra: SUPER_ADMIN não pode acessar conteúdo de documentos
      if (role === 'SUPER_ADMIN') {
        return reply.status(403).send({
          error:
            'SUPER_ADMIN não tem permissão para acessar conteúdo de documentos via IA. Utilize um usuário vinculado a uma empresa.',
        });
      }

      const userId = decoded.sub as number;
      const companyId = (decoded.companyId ?? null) as number | null;
      const departmentId = (decoded.departmentId ?? null) as number | null;
      const divisionId = (decoded.divisionId ?? null) as number | null;

      const { question } = request.body;

      if (!question || question.trim().length === 0) {
        return reply.status(400).send({ error: 'A pergunta é obrigatória' });
      }

      const user = {
        idUsuario: userId,
        idEmpresa: companyId,
        role,
        email: decoded.email,
        departmentId,
        divisionId,
      };

      const accessFilter: AccessFilter = buildAccessFilter(
        role,
        userId,
        companyId,
        departmentId,
        divisionId
      );

      const scope = {
        user,
        accessFilter,
      };

      const iaCoreUrl = process.env.IA_CORE_URL || 'http://localhost:4000/chat';

      const response = await fetch(iaCoreUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          scope,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        app.log.error(
          { status: response.status, body: text },
          '[AI CORE] Erro na chamada'
        );

        return reply
          .status(500)
          .send({ error: 'Erro ao chamar o serviço de IA', details: text });
      }

      const data = await response.json();

      return reply.send({
        question,
        scope,
        answer: data.answer ?? data,
      });
    } catch (err) {
      app.log.error({ err }, '[AI V2] Erro na rota /ai/v2/chat');
      return reply.status(500).send({ error: 'Erro interno na IA v2' });
    }
  });
}
