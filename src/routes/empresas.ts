// src/routes/empresas.ts
import { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

const ensureAdm = async (req: any, reply: any) => {
  const { idEmpresa } = req.user ?? {};
  if (!idEmpresa) return reply.code(401).send({ message: "unauthenticated" });
  const emp = await db("Empresa").select("tp_ADM").where({ idEmpresa }).first();
  if (!emp || emp.tp_ADM !== "S") {
    return reply.code(403).send({ message: "forbidden: requires ADM company" });
  }
};

type EnderecoInput = {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
  referencia?: string | null;
};

/** Converte valores de data (ex. "2025-10-10T14:30") para Date | null */
function toDateOrNull(x: any): Date | null {
  if (!x && x !== 0) return null;
  const s = String(x).trim();
  if (!s) return null;
  const norm = s.includes(" ") ? s.replace(" ", "T") : s;
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(norm)
    ? `${norm}:00`
    : norm;
  const d = new Date(withSeconds);
  return isNaN(d.getTime()) ? null : d;
}

/** Gera uma senha temporária forte */
function genTempPassword(len = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---- helper: resolve segmento (id ou nome) → idSegmento
async function resolveSegmentoId(
  trx: any,
  body: { idSegmento?: number | null; segmento?: string | null }
): Promise<number | null> {
  if (body?.idSegmento && Number.isFinite(Number(body.idSegmento))) {
    const row = await trx("Segmento").where({ idSegmento: body.idSegmento }).first();
    if (!row) throw { status: 400, message: "idSegmento inválido" };
    return Number(body.idSegmento);
  }

  const nome = (body?.segmento ?? "").trim();
  if (!nome) return null;

  const row = await trx("Segmento")
    .whereRaw("LOWER(nome) = LOWER(?)", [nome])
    .first();

  if (!row) {
    throw { status: 400, message: `Segmento '${nome}' não encontrado` };
  }
  return row.idSegmento as number;
}

// ---- helper: resolve plano (id ou nome) → { id, nome, valorMensal }
async function resolvePlano(
  trx: any,
  body: { idPlano?: number | null; plano?: string | null }
): Promise<{ id: number; nome: string; valorMensal: number }> {
  if (body?.idPlano && Number.isFinite(Number(body.idPlano))) {
    const row = await trx("Plano").where({ idPlano: body.idPlano, ativo: 1 }).first();
    if (!row) throw { status: 400, message: "idPlano inválido ou inativo" };
    return { id: Number(body.idPlano), nome: row.nome, valorMensal: Number(row.valorMensal) };
  }

  const nome = (body?.plano ?? "").trim();
  if (!nome) throw { status: 400, message: "Plano é obrigatório" };

  const row = await trx("Plano")
    .whereRaw("LOWER(nome) = LOWER(?)", [nome])
    .andWhere({ ativo: 1 })
    .first();

  if (!row) {
    throw { status: 400, message: `Plano '${nome}' não encontrado ou inativo` };
  }
  return { id: row.idPlano as number, nome: row.nome as string, valorMensal: Number(row.valorMensal) };
}

export const empresasRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /adm/empresas
   * Lista para o grid (todas as empresas) via view.
   */
  app.get(
    "/adm/empresas",
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async () => {
      const rows = await db("vw_Wiseia_ADM_EmpresasGrid")
        .select()
        .orderBy("RazaoSocial", "asc");
      return rows ?? [];
    }
  );

  /**
   * GET /adm/empresas/:id
   * Detalhe via view.
   */
  app.get(
    "/adm/empresas/:id",
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const row = await db("vw_Wiseia_ADM_EmpresasGrid").where("ID", id).first();
      if (!row) return reply.code(404).send({ message: "Empresa não encontrada" });
      return row;
    }
  );

  /**
   * POST /adm/empresas
   * Criação de empresa + endereço (opcional) + assinatura (obrigatória) + usuário primário (obrigatório no front).
   * Aceita idSegmento OU segmento (nome) e idPlano OU plano (nome).
   * Body extra do front:
   *   primaryUser: { nome, email, telefone?, senha? }
   */
  app.post(
    "/adm/empresas",
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (req: any, reply) => {
      const {
        cnpj,
        razaoSocial,
        nomeFantasia,
        telefoneContato,
        emailContato,
        emailFaturamento,
        contato,
        contatoFinanceiro,
        segmento,
        idSegmento,
        plano,
        idPlano,
        dtContratacao,
        dtExpiracao,
        tp_ADM,
        ativo,
        endereco,

        // >>> usa os campos enviados pelo front
        primaryUser, // { nome, email, telefone?, senha? }
      } = req.body ?? {};

      if (!cnpj || !razaoSocial || !nomeFantasia || !emailContato) {
        return reply.code(400).send({ message: "cnpj, razaoSocial, nomeFantasia e emailContato são obrigatórios" });
      }

      // validação do usuário primário (obrigatório no front)
      if (!primaryUser || typeof primaryUser !== "object") {
        return reply.code(400).send({ message: "primaryUser é obrigatório" });
      }
      const { nome: puNome, email: puEmail, telefone: puTelefone, senha: puSenha } = primaryUser;
      if (!puNome || !puEmail) {
        return reply.code(400).send({ message: "primaryUser.nome e primaryUser.email são obrigatórios" });
      }
      if (puSenha && String(puSenha).length > 0 && String(puSenha).length < 8) {
        return reply.code(400).send({ message: "A senha do primaryUser deve ter no mínimo 8 caracteres" });
      }

      const dtContr = toDateOrNull(dtContratacao);
      const dtExp   = toDateOrNull(dtExpiracao);
      if (dtContratacao && !dtContr) return reply.code(400).send({ message: "dtContratacao inválida" });
      if (dtExpiracao && !dtExp)     return reply.code(400).send({ message: "dtExpiracao inválida" });

      // CNPJ único
      const dup = await db("Empresa").where({ cnpj }).first();
      if (dup) return reply.code(409).send({ message: "CNPJ já cadastrado" });

      let idEmpresaCriada: number | undefined;
      let initialUserTempPassword: string | null = null;
      let initialUserEmail: string | null = null;

      try {
        await db.transaction(async (trx) => {
          // === Endereço (opcional)
          let idEndereco: number | null = null;
          if (endereco && typeof endereco === "object") {
            const [addrId] = await trx("Endereco").insert(
              {
                logradouro: endereco.logradouro ?? null,
                numero: endereco.numero ?? null,
                complemento: endereco.complemento ?? null,
                bairro: endereco.bairro ?? null,
                cidade: endereco.cidade ?? null,
                uf: endereco.uf ?? null,
                cep: endereco.cep ?? null,
                referencia: endereco.referencia ?? null,
                created_at: trx.raw("SYSUTCDATETIME()"),
                updated_at: trx.raw("SYSUTCDATETIME()"),
              },
              ["idEndereco"]
            );
            idEndereco = typeof addrId === "object" ? addrId.idEndereco : (addrId as number);
          }

          // === Segmento → idSegmento (opcional)
          const segId = await resolveSegmentoId(trx, { idSegmento, segmento });

          // === Plano → obrigatório (id + valorMensal)
          const planoResolved = await resolvePlano(trx, { idPlano, plano });

          // === Empresa
          const inserted = await trx("Empresa").insert(
            {
              cnpj,
              razaoSocial,
              nomeFantasia,
              telefoneContato: telefoneContato ?? null,
              emailContato,
              emailFaturamento: emailFaturamento ?? null,
              contato: contato ?? null,
              contatoFinanceiro: contatoFinanceiro ?? null,
              idSegmento: segId,
              idPlano: planoResolved.id,
              dtContratacao: dtContr,
              dtExpiracao: dtExp,
              ativo: typeof ativo === "undefined" ? 1 : (ativo ? 1 : 0),
              tp_ADM: tp_ADM ?? null,
              idEndereco: idEndereco,
              created_at: trx.raw("SYSUTCDATETIME()"),
              updated_at: trx.raw("SYSUTCDATETIME()"),
            },
            ["idEmpresa"]
          );

          idEmpresaCriada = Array.isArray(inserted)
            ? (inserted[0]?.idEmpresa ?? inserted[0])
            : (inserted as any);

          // === Assinatura
          await trx("Assinatura").insert({
            idEmpresa: idEmpresaCriada,
            idPlano: planoResolved.id,
            ciclo: "mensal",
            status: "ativa",
            dtInicio: trx.raw("SYSUTCDATETIME()"),
            dtFim: dtExp ?? null,
            diaCobranca: 5,
            valorAtual: planoResolved.valorMensal,
            renovacaoAuto: 1,
            trialAte: null,
            created_at: trx.raw("SYSUTCDATETIME()"),
            updated_at: trx.raw("SYSUTCDATETIME()"),
          });

          // === Usuário primário (ADMIN) a partir de primaryUser
          const primaryNome = String(puNome);
          const primaryEmail = String(puEmail).trim().toLowerCase();
          const primaryTelefone = puTelefone ?? telefoneContato ?? null;

          if (!primaryEmail) {
            throw { status: 400, message: "E-mail do usuário inicial é obrigatório" };
          }

          // e-mail único por empresa
          const emailJaExiste = await trx("Usuario")
            .where("idEmpresa", idEmpresaCriada)
            .whereRaw("LOWER(email) = LOWER(?)", [primaryEmail])
            .first();

          if (emailJaExiste) {
            throw { status: 409, message: "E-mail do usuário primário já está em uso nesta empresa" };
          }

          // senha: usa a enviada (>=8) ou gera temporária
          let senhaHash: string;
          if (puSenha && String(puSenha).length >= 8) {
            senhaHash = await bcrypt.hash(String(puSenha), SALT_ROUNDS);
          } else {
            initialUserTempPassword = genTempPassword();
            senhaHash = await bcrypt.hash(initialUserTempPassword, SALT_ROUNDS);
          }

          await trx("Usuario").insert({
            idEmpresa: idEmpresaCriada,
            nome: primaryNome,
            email: primaryEmail,
            senhaHash,
            telefone: primaryTelefone ?? null,
            role: "ADMIN",
            ativo: 1,
            permsAllow: JSON.stringify([]),
            permsDeny: JSON.stringify([]),
            created_at: trx.raw("SYSUTCDATETIME()"),
            updated_at: trx.raw("SYSUTCDATETIME()"),
          });

          initialUserEmail = primaryEmail;
        });
      } catch (e: any) {
        if (e?.status) return reply.code(e.status).send({ message: e.message });
        throw e;
      }

      const created = await db("vw_Wiseia_ADM_EmpresasGrid").where("ID", idEmpresaCriada).first();

      // Retorna info do usuário inicial (email) e, se gerada, a senha temporária
      return reply.code(201).send({
        ...(created ?? { message: "Criado" }),
        initialUser: {
          email: initialUserEmail,
          ...(initialUserTempPassword ? { tempPassword: initialUserTempPassword } : {}),
        },
      });
    }
  );

  /**
   * PUT /adm/empresas/:id
   * Atualiza Empresa + Endereco (upsert).
   * Aceita idSegmento OU segmento (nome). Grava somente idSegmento.
   * (Obs.: nesta entrega, a Assinatura/Usuário primário não são alterados em updates.)
   */
  app.put(
    "/adm/empresas/:id",
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const base = await db("Empresa").where({ idEmpresa: id }).first();
      if (!base) return reply.code(404).send({ message: "Empresa não encontrada" });

      const {
        cnpj,
        razaoSocial,
        nomeFantasia,
        telefoneContato,
        emailContato,
        emailFaturamento,
        contato,
        contatoFinanceiro,
        segmento,
        idSegmento,
        dtContratacao,
        dtExpiracao,
        tp_ADM,
        ativo,
        endereco,
      } = req.body ?? {};

      // Só consideramos que "veio para atualizar" se não for undefined E tiver algo preenchido
      const hasDtContrSafe =
        typeof dtContratacao !== "undefined" &&
        dtContratacao !== null &&
        String(dtContratacao).trim() !== "";

      const hasDtExpSafe =
        typeof dtExpiracao !== "undefined" &&
        dtExpiracao !== null &&
        String(dtExpiracao).trim() !== "";

      const dtContr = hasDtContrSafe ? toDateOrNull(dtContratacao) : null;
      const dtExp   = hasDtExpSafe   ? toDateOrNull(dtExpiracao)   : null;

      // Validações: só validamos se realmente veio um valor para atualizar
      if (hasDtContrSafe && !dtContr)
        return reply.code(400).send({ message: "dtContratacao inválida" });
      if (hasDtExpSafe && !dtExp)
        return reply.code(400).send({ message: "dtExpiracao inválida" });

      try {
        await db.transaction(async (trx) => {
          // upsert endereço
          let idEndereco = base.idEndereco ?? null;
          if (endereco && typeof endereco === "object") {
            if (idEndereco) {
              await trx("Endereco")
                .where({ idEndereco })
                .update({
                  logradouro: endereco.logradouro ?? null,
                  numero: endereco.numero ?? null,
                  complemento: endereco.complemento ?? null,
                  bairro: endereco.bairro ?? null,
                  cidade: endereco.cidade ?? null,
                  uf: endereco.uf ?? null,
                  cep: endereco.cep ?? null,
                  referencia: endereco.referencia ?? null,
                  updated_at: trx.raw("SYSUTCDATETIME()"),
                });
            } else {
              const [addrId] = await trx("Endereco").insert(
                {
                  logradouro: endereco.logradouro ?? null,
                  numero: endereco.numero ?? null,
                  complemento: endereco.complemento ?? null,
                  bairro: endereco.bairro ?? null,
                  cidade: endereco.cidade ?? null,
                  uf: endereco.uf ?? null,
                  cep: endereco.cep ?? null,
                  referencia: endereco.referencia ?? null,
                  created_at: trx.raw("SYSUTCDATETIME()"),
                  updated_at: trx.raw("SYSUTCDATETIME()"),
                },
                ["idEndereco"]
              );
              idEndereco = typeof addrId === "object" ? addrId.idEndereco : (addrId as number);
            }
          }

          // Segmento → idSegmento (se algo foi enviado)
          let segIdToSave: number | null | undefined = undefined;
          if (typeof idSegmento !== "undefined" || typeof segmento !== "undefined") {
            segIdToSave = await resolveSegmentoId(trx, { idSegmento, segmento });
          }

          // Monta o payload de update sem tocar na dtContratacao quando vier null/""/undefined
          const updatePayload: any = {
            cnpj: cnpj ?? base.cnpj,
            razaoSocial: razaoSocial ?? base.razaoSocial,
            nomeFantasia: nomeFantasia ?? base.nomeFantasia,
            telefoneContato: telefoneContato ?? base.telefoneContato,
            emailContato: emailContato ?? base.emailContato,
            emailFaturamento: emailFaturamento ?? base.emailFaturamento,
            contato: contato ?? base.contato,
            contatoFinanceiro: contatoFinanceiro ?? base.contatoFinanceiro,
            tp_ADM: typeof tp_ADM !== "undefined" ? tp_ADM : base.tp_ADM,
            ativo: typeof ativo !== "undefined" ? (ativo ? 1 : 0) : base.ativo,
            idEndereco: idEndereco,
            updated_at: trx.raw("SYSUTCDATETIME()"),
          };

          if (typeof segIdToSave !== "undefined") {
            updatePayload.idSegmento = segIdToSave;
          }
          if (hasDtContrSafe) {
            // Só coloca a coluna no UPDATE se realmente for para atualizar
            updatePayload.dtContratacao = dtContr;
          }
          if (hasDtExpSafe) {
            updatePayload.dtExpiracao = dtExp;
          }

          await trx("Empresa").where({ idEmpresa: id }).update(updatePayload);
        });
      } catch (e: any) {
        if (e?.status) return reply.code(e.status).send({ message: e.message });
        throw e;
      }

      const updated = await db("vw_Wiseia_ADM_EmpresasGrid").where("ID", id).first();
      return updated ?? {};
    }
  );

  /**
   * DELETE /adm/empresas/:id
   * Desativação (soft delete): ativo = 0
   */
  app.delete(
    "/adm/empresas/:id",
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const exists = await db("Empresa").where({ idEmpresa: id }).first();
      if (!exists) return reply.code(404).send({ message: "Empresa não encontrada" });

      await db("Empresa").where({ idEmpresa: id }).update({
        ativo: 0,
        updated_at: db.raw("SYSUTCDATETIME()"),
      });

      return { deactivated: true };
    }
  );

  /**
   * PUT /adm/empresas/:id/ativar
   * Reativação + renovação de vigência (30 dias padrão; pode vir no body)
   */
  app.put(
    "/adm/empresas/:id/ativar",
    { preHandler: [(app as any).authenticate, ensureAdm] },
    async (req: any, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return reply.code(400).send({ message: "id inválido" });

      const dias = Number(req.body?.dias || 30);

      await db("Empresa")
        .where({ idEmpresa: id })
        .update({
          ativo: 1,
          dtContratacao: db.raw("SYSUTCDATETIME()"),
          dtExpiracao: db.raw("DATEADD(DAY, ?, SYSUTCDATETIME())", [dias]),
          updated_at: db.raw("SYSUTCDATETIME()"),
        });

      const row = await db("vw_Wiseia_ADM_EmpresasGrid").where("ID", id).first();
      return row ?? { reactivated: true };
    }
  );
};

export default empresasRoutes;
