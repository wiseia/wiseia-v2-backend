import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';

export default fp(async (fastify) => {
    fastify.register(jwt, {
        secret: process.env.JWT_SECRET || 'your-secret-key-CHANGE-IN-PRODUCTION-use-env-variable'
    });

    fastify.log.info('JWT plugin registered successfully');
});
