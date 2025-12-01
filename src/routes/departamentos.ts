// src/routes/departamentos.ts
import { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { sftpStorage } from "../storage/sftp.js";
import { requirePerm } from "../auth/requirePerm.js";

// helper para deixar o nome seguro em path
function slugify(input: string) {
  return input
    .normalize("NFD") // separa acentos
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^A-Za-z0-9._-]+/g, "-") // troca qualquer coisa por '-'
    .replace(/-+/g, "-") // colapsa '-'
    .replace(/^[-_.]+|[-_.]+$/g, "") // tira pontas
    .toLowerCase()
    .slice(0, 80); // limite opcional
}

type DepCreateBody = {
  nome: string;
  descricao?: string | null;
  ativo?: 0 | 1 | boolean;
};

type DepUpdateBody = {
  nome?: string;
  descricao?: string | null;
  ativo?: 0 | 1 | boolean;
};

export const departamentosRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /departamentos
   * Lista departamentos da empresa (via VIEW).
   */
  app.get(
    "/departamentos",
    {
      preHandler: [
        (app as any).authenticate,
        requirePerm("departments:view"),
      ],
    },
    async (req: any) => {
      const rows = await db("vw_Wiseia_Departamentos")
        .where("idEmpresa", req.user.idEmpresa)
        .orderBy("nome", "asc");

      return rows ?? [];
    }
  );

  /**
   * GET /departamentos/:id
   * Detalhe de um departamento (via VIEW).
   */
  app.get(
    "/departamentos/:id",
    {
      preHandler: [
        (app as any).authenticate,
        requirePerm("departments:view"),
      ],
    },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ message: "id inválido" });
      }

      const row = await db("vw_Wiseia_Departamentos")
        .where({ idDepartamento: id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!row) return reply.code(404).send({ message: "Departamento não encontrado" });
      return row;
    }
  );

  /**
   * POST /departamentos
   * Cria um departamento na empresa logada.
   * Body: { nome, descricao?, ativo? }
   */
  app.post(
    "/departamentos",
    {
      preHandler: [
        (app as any).authenticate,
        requirePerm("departments:create"),
      ],
    },
    async (req: any, reply) => {
      const body: DepCreateBody = req.body ?? {};
      const nome = String(body.nome ?? "").trim();
      if (!nome) return reply.code(400).send({ message: "nome é obrigatório" });

      const ativo = body.ativo === true || body.ativo === 1 ? 1 : 0;
      const descricao = body.descricao ?? null;
      const idEmpresa = req.user.idEmpresa;

      const trx = await db.transaction();
      try {
        // MSSQL: use OUTPUT para obter o id inserido de forma confiável
        const inserted = await trx.raw<[{ idDepartamento: number }[]]>(
          `
          INSERT INTO Departamento (idEmpresa, nome, descricao, ativo)
          OUTPUT INSERTED.idDepartamento
          VALUES (?, ?, ?, ?)
        `,
          [idEmpresa, nome, descricao, ativo]
        );

        // dependendo do driver/knex, o shape pode variar:
        const idDepartamento =
          Array.isArray(inserted) && Array.isArray(inserted[0])
            ? (inserted[0][0] as any).idDepartamento
            : (inserted as any)?.[0]?.idDepartamento ?? (inserted as any)?.id;

        if (!idDepartamento) {
          throw new Error("Não foi possível obter idDepartamento (OUTPUT).");
        }

        // ---- SFTP: cria a pasta do departamento ----
        const relDir = `empresas/${idEmpresa}/departamentos/${idDepartamento}`;
        await sftpStorage.ensureDir(relDir);

        await trx.commit();

        // retorna o registro via VIEW já consistente
        const created = await db("vw_Wiseia_Departamentos")
          .where({ idEmpresa, idDepartamento })
          .first();

        return reply.code(201).send(
          created ?? {
            idDepartamento,
            idEmpresa,
            nome,
            ativo,
          }
        );
      } catch (err: any) {
        await trx.rollback();
        req.log?.error?.({ err }, "erro ao criar departamento + sftp");
        const msg = String(err?.message || "");
        // mapeia alguns erros comuns do SFTP
        if (/permission|denied|auth/i.test(msg)) {
          return reply
            .code(502)
            .send({ message: "Falha no SFTP (permissão/autenticação)", detail: msg });
        }
        return reply
          .code(500)
          .send({ message: "Falha ao criar departamento", detail: msg });
      }
    }
  );

  /**
   * PUT /departamentos/:id
   * Atualiza dados do departamento (tabela base).
   * Body: { nome?, descricao?, ativo? }
   */
  app.put(
    "/departamentos/:id",
    {
      preHandler: [
        (app as any).authenticate,
        requirePerm("departments:update"),
      ],
    },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      // Garante que pertence à empresa
      const exists = await db("Departamento")
        .where({ idDepartamento: id, idEmpresa: req.user.idEmpresa })
        .first();
      if (!exists) return reply.code(404).send({ message: "Departamento não encontrado" });

      const body: DepUpdateBody = req.body ?? {};
      const patch: any = {};

      if (typeof body.nome === "string" && body.nome.trim()) patch.nome = body.nome.trim();
      if (typeof body.descricao === "string") patch.descricao = body.descricao;
      if (typeof body.ativo !== "undefined") {
        patch.ativo = body.ativo === true || body.ativo === 1 ? 1 : 0;
      }

      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({ message: "Nada para atualizar" });
      }

      await db("Departamento")
        .where({ idDepartamento: id, idEmpresa: req.user.idEmpresa })
        .update(patch);

      // retorna já pela VIEW
      const row = await db("vw_Wiseia_Departamentos")
        .where({ idDepartamento: id, idEmpresa: req.user.idEmpresa })
        .first();

      return row ?? { updated: true };
    }
  );

  /**
   * DELETE /departamentos/:id
   * Exclui o departamento (tabela base).
   * Obs: se precisar, aqui dá para impedir exclusão caso existam vínculos.
   */
  app.delete(
    "/departamentos/:id",
    {
      preHandler: [
        (app as any).authenticate,
        requirePerm("departments:update"), // se futuramente criar "departments:delete", troque aqui
      ],
    },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const exists = await db("Departamento")
        .where({ idDepartamento: id, idEmpresa: req.user.idEmpresa })
        .first();
      if (!exists) return reply.code(404).send({ message: "Departamento não encontrado" });

      // Se quiser bloquear quando houver usuários/documentos:
      // const vinc = await db("UsuarioDepartamento").where({ idDepartamento: id }).first();
      // if (vinc) return reply.code(409).send({ message: "Departamento possui vínculos" });

      await db("Departamento")
        .where({ idDepartamento: id, idEmpresa: req.user.idEmpresa })
        .del();

      return { deleted: true };
    }
  );

  // Rota para listar usuários de um departamento
  app.get(
    "/departamentos/:id/usuarios",
    {
      preHandler: [
        (app as any).authenticate,
        requirePerm("users:view"),
      ],
    },
    async (req: any, reply: any) => {
      const idDepartamento = Number(req.params.id);
      if (!idDepartamento || isNaN(idDepartamento)) {
        return reply.code(400).send({ error: "invalid_idDepartamento" });
      }

      // Busca usuários ativos do departamento via UsuarioDepartamento
      const usuarios = await db("UsuarioDepartamento as ud")
        .join("Usuario as u", "ud.idUsuario", "u.idUsuario")
        .where({ "ud.idDepartamento": idDepartamento })
        .select("u.idUsuario", "u.nome", "u.email", "u.role", "u.ultimoLogin", "u.ativo");

      return { items: usuarios };
    }
  );

  // Departamentos do usuário logado (utilitário para filtros, etc.)
  app.get(
    "/me/departamentos",
    { preHandler: (app as any).authenticate },
    async (req: any) => {
      // retorna somente os departamentos ATIVOS da empresa do usuário
      // aos quais o usuário logado está vinculado
      const rows = await db("vw_Wiseia_Departamentos as d")
        .join("UsuarioDepartamento as ud", "ud.idDepartamento", "d.idDepartamento")
        .where("d.idEmpresa", req.user.idEmpresa)
        .andWhere("ud.idUsuario", req.user.idUsuario)
        .andWhere("d.ativo", 1) // garante depto ativo
        // se houver flag de vínculo ativo em UsuarioDepartamento, descomente:
        // .andWhere("ud.ativo", 1)
        .select("d.idDepartamento", "d.nome", "d.descricao", "d.ativo")
        .orderBy("d.nome", "asc");

      return { items: rows };
    }
  );
};
