import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { env } from '../env.js';

declare module 'fastify' {
	interface FastifyRequest {
		user?: {
			idUsuario: number;
			idEmpresa: number;
			role: string;
			email: string;
		}
	}
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
	app.decorate('authenticate', async (req: any, reply: any) => {
		const h = req.headers.authorization;
		if (!h?.startsWith('Bearer ')) {
			return reply.code(401).send({ error: 'missing_token' });
		}
		try {
			const token = h.substring(7);
			const payload = jwt.verify(token, env.JWT_SECRET) as any;
			req.user = {
				idUsuario: payload.idUsuario,
				idEmpresa: payload.idEmpresa,
				role: payload.role,
				email: payload.email
			};
		} catch {
			return reply.code(401).send({ error: 'invalid_token' });
		}
	});
});
