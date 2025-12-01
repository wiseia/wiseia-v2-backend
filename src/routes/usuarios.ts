// src/routes/usuarios.ts
import { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import bcrypt from "bcryptjs";
import { calcEffectivePerms } from "../auth/effectivePerms.js";
import { requirePerm } from "../auth/requirePerm.js";

const SALT_ROUNDS = 10;

export const usuariosRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /usuarios
   * Lista todos os usuários da empresa logada (via view segura).
   */
  app.get(
    "/usuarios",
    { preHandler: [(app as any).authenticate, requirePerm("users:view")] },
    async (req: any) => {
      const rows = await db("vw_Wiseia_Usuarios")
        .where("idEmpresa", req.user.idEmpresa)
        .orderBy("nome", "asc");

      return rows ?? [];
    }
  );

  /**
   * GET /usuarios/:id
   * Detalhe de um usuário (via view), garantindo escopo da empresa.
   */
  app.get(
    "/usuarios/:id",
    { preHandler: [(app as any).authenticate, requirePerm("users:view")] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const row = await db("vw_Wiseia_Usuarios")
        .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!row) return reply.code(404).send({ message: "Usuário não encontrado" });
      return row;
    }
  );

  /**
   * POST /usuarios
   * Criação de usuário na empresa logada (tabela base).
   * Body esperado: { nome, email, senha, telefone?, role?, ativo? }
   */
  app.post(
    "/usuarios",
    { preHandler: [(app as any).authenticate, requirePerm("users:create")] },
    async (req: any, reply) => {
      const { nome, email, senha, telefone, role, ativo, departamentoIds } = req.body ?? {};
      if (!nome || !email || !senha) {
        return reply.code(400).send({ message: "nome, email e senha são obrigatórios" });
      }

      // e-mail único por empresa (case-insensitive)
      const emailJaExiste = await db("Usuario")
        .where("idEmpresa", req.user.idEmpresa)
        .whereRaw("LOWER(email) = LOWER(?)", [email])
        .first();

      if (emailJaExiste) {
        return reply.code(409).send({ message: "E-mail já cadastrado nesta empresa" });
      }

      const senhaHash = await bcrypt.hash(String(senha), SALT_ROUNDS);

      let idUsuario: number | undefined;
      await db.transaction(async (trx) => {
        // insert usuario
        const ids = await trx("Usuario").insert(
          {
            idEmpresa: req.user.idEmpresa,
            nome,
            email,
            senhaHash,
            telefone: telefone ?? null,
            role: role ?? "USER",
            ativo: ativo ?? 1,
          },
          ["idUsuario"]
        );
        idUsuario = Array.isArray(ids) ? ids[0]?.idUsuario ?? ids[0] : ids;

        // vincula departamentos
        if (Array.isArray(departamentoIds) && idUsuario) {
          const rows = departamentoIds.map((idDepartamento: number) => ({
            idUsuario,
            idDepartamento,
            idEmpresa: req.user.idEmpresa,
            permissao: "LEITURA",
          }));
          if (rows.length > 0) {
            await trx("UsuarioDepartamento").insert(rows);
          }
        }
      });

      // busca o criado via view (pelo email)
      const created = await db("vw_Wiseia_Usuarios")
        .where("idEmpresa", req.user.idEmpresa)
        .whereRaw("LOWER(email) = LOWER(?)", [email])
        .first();

      return reply.code(201).send(created ?? { message: "Criado" });
    }
  );

  /**
   * DELETE /usuarios/:id
   * Remove o usuário da empresa (tabela base).
   * Proteções mínimas: não permite deletar a si mesmo.
   * (Usa users:update por não haver users:delete no catálogo)
   */
  app.delete(
    "/usuarios/:id",
    { preHandler: [(app as any).authenticate, requirePerm("users:update")] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      // não deletar a si mesmo
      if (id === req.user.idUsuario) {
        return reply.code(400).send({ message: "Você não pode excluir seu próprio usuário" });
      }

      // checa se pertence à empresa
      const exists = await db("Usuario")
        .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!exists) return reply.code(404).send({ message: "Usuário não encontrado" });

      await db("Usuario").where({ idUsuario: id, idEmpresa: req.user.idEmpresa }).del();

      return { deleted: true };
    }
  );

  /**
   * PUT /usuarios/:id
   * Atualiza dados do usuário e vínculos com departamentos.
   */
  app.put(
    "/usuarios/:id",
    { preHandler: [(app as any).authenticate, requirePerm("users:update")] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const { nome, email, telefone, role, ativo, departamentoIds } = req.body ?? {};

      // escopo
      const user = await db("Usuario")
        .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!user) return reply.code(404).send({ message: "Usuário não encontrado" });

      // atualização + vínculos em TX
      await db.transaction(async (trx) => {
        await trx("Usuario")
          .where({ idUsuario: id })
          .update({
            nome,
            email,
            telefone: telefone ?? null,
            role,
            ativo: ativo ?? 1,
            updated_at: trx.raw("SYSUTCDATETIME()"),
          });

        if (Array.isArray(departamentoIds)) {
          // limpa e grava de novo
          await trx("UsuarioDepartamento")
            .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
            .del();

          if (departamentoIds.length > 0) {
            const rows = departamentoIds.map((idDepartamento: number) => ({
              idUsuario: id,
              idDepartamento,
              idEmpresa: req.user.idEmpresa,
              permissao: "LEITURA",
            }));
            await trx("UsuarioDepartamento").insert(rows);
          }
        }
      });

      // devolve a linha atualizada via view
      const updated = await db("vw_Wiseia_Usuarios")
        .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
        .first();

      return updated ?? {};
    }
  );

  /**
   * GET /usuarios/:id/departamentos
   * Lista ids de departamentos vinculados a um usuário.
   */
  app.get(
    "/usuarios/:id/departamentos",
    { preHandler: [(app as any).authenticate, requirePerm("users:view")] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ message: "id inválido" });
      }

      // Confere escopo
      const user = await db("Usuario")
        .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
        .first();

      if (!user) return reply.code(404).send({ message: "Usuário não encontrado" });

      const rows = await db("UsuarioDepartamento")
        .where({ idUsuario: id })
        .select("idDepartamento");

      return rows.map((r) => r.idDepartamento);
    }
  );


  /**
   * GET /usuarios/:id/permissoes
   * Retorna o snapshot de overrides (allow/deny) de um usuário.
   * (Somente para quem pode atualizar usuários)
   */
  app.get(
  "/me",
  { preHandler: (app as any).authenticate },
  async (req: any) => {
    // dados do usuário via VIEW (mantém sua segurança/escopo)
    const user = await db("vw_Wiseia_Usuarios")
      .where({ idUsuario: req.user.idUsuario, idEmpresa: req.user.idEmpresa })
      .first();

    // base para perms
    const base = await db("Usuario")
      .where({ idUsuario: req.user.idUsuario, idEmpresa: req.user.idEmpresa })
      .first();

    // pega o tp_ADM direto da tabela Empresa
    const empresa = await db("Empresa")
      .select("tp_ADM", "nomeFantasia")
      .where({ idEmpresa: req.user.idEmpresa })
      .first();

    const perms = calcEffectivePerms(
      String(user.role || "USER") as any,
      base?.permsAllow ?? null,
      base?.permsDeny ?? null
    );

    return {
      idUsuario: user.idUsuario,
      idEmpresa: user.idEmpresa,
      nome: user.nome,
      role: user.role,
      email: user.email,
      perms,
      empresa: {
        idEmpresa: req.user.idEmpresa,
        nomeFantasia: empresa?.nomeFantasia ?? null,
        tp_ADM: empresa?.tp_ADM ?? null,
      },
      isAdm: empresa?.tp_ADM === "S",
    };
  }
);

  /**
   * PUT /usuarios/:id/permissoes
   * Atualiza overrides (allow/deny) de um usuário.
   */
  app.put(
    "/usuarios/:id/permissoes",
    { preHandler: [(app as any).authenticate, requirePerm("users:update")] },
    async (req: any) => {
      const id = Number(req.params.id);
      const { allow, deny } = req.body ?? {};
      await db("Usuario")
        .where({ idUsuario: id, idEmpresa: req.user.idEmpresa })
        .update({
          permsAllow: JSON.stringify(Array.isArray(allow) ? allow : []),
          permsDeny: JSON.stringify(Array.isArray(deny) ? deny : []),
          updated_at: db.raw("SYSUTCDATETIME()"),
        });

      return { ok: true };
    }
  );
};
