// src/routes/utils.ts
import { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";

// (opcional) se quiser exigir empresa ADM para acessar utilitários
const ensureAdm = async (req: any, reply: any) => {
  const { idEmpresa } = req.user ?? {};
  if (!idEmpresa) return reply.code(401).send({ message: "unauthenticated" });
  const row = await db("Empresa").select("tp_ADM").where({ idEmpresa }).first();
  if (!row || row.tp_ADM !== "S") {
    return reply.code(403).send({ message: "forbidden: requires ADM company" });
  }
};

type SegRow = { id: number; nome: string; ativo: number };
type PlanRow = { id: number; nome: string; ativo: number };

// helper: normalização de busca simples (case-insensitive)
// retorna SQL "LOWER(campo) LIKE LOWER('%term%')"
const likeInsensitive = (col: string, term: string) =>
  db.raw(`LOWER(${col}) LIKE LOWER(?)`, [`%${term}%`]);

export const utilsRoutes: FastifyPluginAsync = async (app) => {
  // Todas as rotas utilitárias ficam sob /adm/utils
  app.register(
    async (r) => {
      // Autenticação obrigatória; autorização ADM (opcional, mas recomendado no painel ADM)
      (r as any).addHook("preHandler", (app as any).authenticate);
      (r as any).addHook("preHandler", ensureAdm);

      /**
       * GET /adm/utils/segmentos
       * Listagem para combos/filtros.
       * Query params:
       *  - all=1     → inclui inativos (por padrão retorna só ativos)
       *  - q=texto   → filtro por nome (contains, case-insensitive)
       */
      r.get("/segmentos", async (req: any) => {
        const all = String(req.query?.all ?? "").toLowerCase() === "1";
        const q = (String(req.query?.q ?? "") || "").trim();

        const query = db("Segmento")
          .select({ id: "idSegmento", nome: "nome", ativo: "ativo" as any })
          .modify((qb) => {
            if (!all) qb.where({ ativo: 1 });
            if (q) qb.andWhere(likeInsensitive("nome", q));
          })
          .orderBy("nome", "asc");

        const rows = (await query) as SegRow[];
        return rows ?? [];
      });

      /**
       * GET /adm/utils/planos
       * Lista planos para combos/filtros.
       * Query params:
       *  - all=1     → inclui inativos (padrão: só ativos)
       *  - q=texto   → filtro por nome (contains, case-insensitive)
       *
       * Obs.: Mantemos resposta enxuta (id/nome/ativo) para uso em selects.
       * Caso precise dos limites/valores no futuro, basta adicionar os campos.
       */
      r.get("/planos", async (req: any) => {
        const all = String(req.query?.all ?? "").toLowerCase() === "1";
        const q = (String(req.query?.q ?? "") || "").trim();

        const query = db("Plano")
          .select({
            id: "idPlano",
            nome: "nome",
            ativo: "ativo" as any,
            // Ex: descomente se quiser expor mais informações ao front:
            // descricao: "descricao",
            // valorMensal: "valorMensal",
            // espacoMaxMB: "espacoMaxMB",
            // usuariosMax: "usuariosMax",
            // documentosMax: "documentosMax",
          })
          .modify((qb) => {
            if (!all) qb.where({ ativo: 1 });
            if (q) qb.andWhere(likeInsensitive("nome", q));
          })
          .orderBy("nome", "asc");

        const rows = (await query) as PlanRow[];
        return rows ?? [];
      });

      // === Espaço reservado para próximas rotas utilitárias ===
      // r.get("/status", async () => {...});
      // r.get("/ufs", async () => {...});
    },
    { prefix: "/adm/utils" }
  );
};

export default utilsRoutes;
