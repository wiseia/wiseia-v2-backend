// src/plugins/authJwt.ts
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export async function authJwtPlugin(app: FastifyInstance) {
  app.decorate(
    'authenticate',
    async (request: any, reply: any) => {
      try {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return reply.status(401).send({ error: 'Token não informado' });
        }

        const token = authHeader.replace('Bearer ', '').trim();
        const decoded: any = jwt.verify(token, JWT_SECRET);

        // Aqui definimos o formato do usuário dentro do request
        request.user = {
          idUsuario: decoded.sub,
          idEmpresa: decoded.companyId ?? null,
          role: decoded.role,
          email: decoded.email,
        };
      } catch (err) {
        request.log.error({ err }, '[AUTH] Token inválido');
        return reply.status(401).send({ error: 'Token inválido ou expirado' });
      }
    }
  );
}
