// src/routes/authRoutes.ts
import type { FastifyInstance } from 'fastify';
import { login } from '../services/authService.js';

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/auth/login', async (request: any, reply: any) => {
    try {
      // DEBUG: Log everything
      console.log('[AUTH] ========== Login Request ==========');
      console.log('[AUTH] Headers:', JSON.stringify(request.headers, null, 2));
      console.log('[AUTH] Body:', JSON.stringify(request.body, null, 2));
      console.log('[AUTH] Raw body type:', typeof request.body);
      console.log('[AUTH] ========================================');

      const { email, password } = request.body;

      if (!email || !password) {
        console.log('[AUTH] Missing fields - email:', !!email, 'password:', !!password);
        return reply.status(400).send({ error: 'Email e senha são obrigatórios' });
      }

      const result = await login(email, password);

      return reply.send({
        token: result.token,
        user: result.user,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      app.log.error(`[AUTH] Erro no login: ${errorMsg}`);
      return reply.status(401).send({ error: 'Credenciais inválidas' });
    }
  });
}
