// src/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwtPlugin from './plugins/jwt.js';
import { authPlugin } from './middleware/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';

export function buildServer() {
  const app = Fastify({
    logger: true,
  });

  // Register CORS to allow frontend requests
  app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000'
    ],
    credentials: true
  });

  // Register rate limiting (protects all routes)
  app.register(rateLimitPlugin);

  // Register JWT plugin
  app.register(jwtPlugin);

  // Register auth decorators
  app.register(authPlugin);

  return app;
}
