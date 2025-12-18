import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

export interface AuthenticatedUser {
	userId: string;
	companyId: string;
	email: string;
	isAdmin: boolean;
	cargo?: string;
}

declare module 'fastify' {
	interface FastifyRequest {
		user: AuthenticatedUser;
	}
}

/**
 * Authentication plugin that adds authenticate and requireManager decorators
 */
export const authPlugin: FastifyPluginAsync = fp(async (app) => {
	// Decorator for JWT verification
	app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
		try {
			await request.jwtVerify();
			// Token payload is now in request.user
		} catch (err) {
			reply.status(401).send({ error: 'Não autenticado' });
		}
	});

	// Decorator for Manager role check
	app.decorate('requireManager', (request: FastifyRequest, reply: FastifyReply) => {
		const user = request.user as AuthenticatedUser;
		if (!user.isAdmin && !user.cargo?.toLowerCase().includes('manager')) {
			reply.status(403).send({ error: 'Apenas Managers podem executar esta ação' });
		}
	});

	app.log.info('Auth decorators registered successfully');
});
