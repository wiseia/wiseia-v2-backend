import { buildServer } from './server.js';
import { env } from './env.js';
import { pingDB } from './db.js';

// ✅ IMPORTA A ROTA DA IA
import aiRoutes from "./routes/ai.routes.js";

const app = buildServer();

// ✅ REGISTRA ROTA DA IA NO FASTIFY
app.register(aiRoutes, { prefix: "/api/ai" });

async function main() {
  await pingDB();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`WISEIA backend up on :${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
