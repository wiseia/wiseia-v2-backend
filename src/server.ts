// src/server.ts (ou onde você monta o app)
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';

import { authPlugin } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { documentosRoutes } from './routes/documentos.js';
import { usuariosRoutes } from './routes/usuarios.js';
import { departamentosRoutes } from './routes/departamentos.js';
import { utilsRoutes } from "./routes/utils.js";

// ✅ NOVOS IMPORTS (painel ADM)
import { dashboardAdmRoutes } from './routes/dashboardadm.js';
// Se exportou default, use: import dashboardAdmRoutes from './routes/dashboardadm.js'
import { empresasRoutes } from './routes/empresas.js';
import { chatRoutes } from './routes/chat.js';
import aiV2Routes from './routes/aiV2.js';
// Se exportou default, use: import empresasRoutes from './routes/empresas.js'

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(sensible);
  app.register(cors, { origin: true, credentials: true });
  app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });

  // 🔑 multipart ANTES das rotas
  app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024) },
    throwFileSizeLimit: true,
  });

  // Auth (JWT, decorators, etc.)
  app.register(authPlugin);

  // Healthcheck
  app.get('/health', async () => ({ ok: true }));

  // Rotas existentes
  app.register(authRoutes);
  app.register(dashboardRoutes);
  app.register(documentosRoutes);
  app.register(usuariosRoutes);
  app.register(departamentosRoutes);
  app.register(chatRoutes);

  // Rotas da IA v2 (RAG prototype)
  app.register(aiV2Routes);

  // 🚀 Rotas do Painel ADM
  app.register(dashboardAdmRoutes);
  app.register(empresasRoutes);
  app.register(utilsRoutes);

  // Log de conferência
  app.ready(err => {
    if (err) app.log.error(err);
    app.log.info({ hasMultipart: app.hasContentTypeParser('multipart') }, 'multipart parser');
  });

  return app;
}
