import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

/**
 * Rate limiting plugin to protect against brute force and DDoS attacks
 */
export default fp(async (fastify) => {
    await fastify.register(rateLimit, {
        max: 100, // 100 requests
        timeWindow: '1 minute', // per minute per IP
        cache: 10000, // cache size
        allowList: ['127.0.0.1'], // localhost always allowed for development
        redis: undefined, // Use in-memory by default, can configure Redis for production
        skipOnError: true, // Continue even if rate limit check fails
        ban: 5, // Ban after 5 violations
        continueExceeding: true,
        enableDraftSpec: true,
        errorResponseBuilder: (request, context) => {
            return {
                statusCode: 429,
                error: 'Too Many Requests',
                message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`
            };
        },
        // Custom rate limits for specific routes
        nameSpace: 'wiseia-rate-limit-'
    });

    fastify.log.info('Rate limiting enabled: 100 req/min per IP');
});
