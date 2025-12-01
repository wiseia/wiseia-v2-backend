import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { env } from '../env.js';
import bcrypt from 'bcryptjs';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', async (req, reply) => {
    const schema = z.object({
      email: z.string().email(),
      senha: z.string().min(1),
    });

    const { email, senha } = schema.parse(req.body);
    const emailNorm = email.trim().toLowerCase();

    // Busca o(s) usuário(s) ativo(s) pelo e-mail (sem exigir idEmpresa no body)
    const users = await db('Usuario as u')
      .select('u.*')
      .where('u.email', emailNorm)
      .andWhere('u.ativo', 1);

    if (users.length === 0) {
      return reply.code(401).send({ error: 'Senha Incorreta' });
    }

    // Se o mesmo e-mail existir em mais de uma empresa, retornamos conflito
    if (users.length > 1) {
      return reply.code(409).send({
        error: 'ambiguous_company',
        empresas: users.map((u) => u.idEmpresa),
      });
    }

    const user = users[0];

    // Valida senha (bcrypt)
    const ok = await bcrypt.compare(senha, user.senhaHash).catch(() => false);
    if (!ok) {
      return reply.code(401).send({ error: 'Senha Incorreta' });
    }

    // Atualiza ultimoLogin
    await db('Usuario')
      .update({ ultimoLogin: db.raw('SYSUTCDATETIME()') })
      .where({ idUsuario: user.idUsuario });

    // Gera JWT com idEmpresa inferido
    const token = jwt.sign(
      {
        idUsuario: user.idUsuario,
        idEmpresa: user.idEmpresa,
        role: user.role,
        email: user.email,
      },
      env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return { token };
  });
};
