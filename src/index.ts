// src/index.ts
import { buildServer } from './server.js';
import { env } from './env.js';
import { pingDB } from './db.js';

import aiRoutes from './routes/ai.routes.js';
import { authRoutes } from './routes/authRoutes.js';
import { meRoutes } from './routes/meRoutes.js';
import { aiV2Routes } from './routes/aiV2.js';
import { orgRoutes } from './routes/orgRoutes.js';
import { authJwtPlugin } from './plugins/authJwt.js';
// DISABLED: departamentos uses Knex db which isn't in this project
// import { departamentosRoutes } from './routes/departamentos.js';

// Import existing modules
// TEMPORARILY DISABLED - has import errors, using new API v1 instead
// import { documentsRoutes } from './modules/documents/documents.routes.js'}

;

// Import new API v1 routes
import { apiV1Routes } from './routes/api/v1/index.js';

const app = buildServer();

// plugin de autenticação (adiciona app.authenticate)
app.register(authJwtPlugin);

// Legacy routes
app.register(aiRoutes, { prefix: '/api/ai' });
app.register(authRoutes);
app.register(meRoutes);
app.register(aiV2Routes, { prefix: '/ai/v2' });
app.register(orgRoutes);
// DISABLED: departamentos routes use Knex which isn't setup
// app.register(departamentosRoutes);
// DISABLED: app.register(documentsRoutes);

// NEW: API v1 routes (documents, notebooks, alerts)
app.register(apiV1Routes, { prefix: '/api/v1' });

async function main() {
  await pingDB();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`WISEIA backend up on :${env.PORT}`);
  app.log.info(`API v1 available at: http://localhost:${env.PORT}/api/v1`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
