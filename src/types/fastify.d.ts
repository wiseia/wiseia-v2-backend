// src/types/fastify.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name?: string;
      role: string;
      companyId: string | null;
      departmentId: string | null;
      divisionId: string | null;
    };
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
