// src/auth/requirePerm.ts
import type { FastifyReply } from "fastify";
import { db } from "../db.js";
import { ROLE_PERMS } from "./permissions.js";
import type { Role, Perm } from "./permissions.js";

// cache simples (1 minuto)
const cache = new Map<string, { at: number; perms: Perm[] }>();
const TTL = 0.5_000;

// — helpers —

function toRole(v: unknown): Role {
  const s = String(v ?? "").toUpperCase() as Role;
  const roles = ["ADMIN", "MANAGER", "USER"] as const;
  return (roles as readonly string[]).includes(s) ? (s as Role) : "USER";
}

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function calcEffectivePerms(role: Role, allow: string[], deny: string[]): Perm[] {
  const base = new Set<string>(ROLE_PERMS[role] ?? []);
  // allow ganha do default
  for (const k of allow) base.add(k);
  // deny ganha de todos
  for (const k of deny) base.delete(k);
  return Array.from(base) as Perm[];
}

async function getEffectivePerms(idEmpresa: number, idUsuario: number): Promise<Perm[]> {
  const key = `${idEmpresa}:${idUsuario}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL) return hit.perms;

  // busca colunas “cruas” (role, permsAllow, permsDeny) na tabela base
  const base = await db("Usuario")
    .select("role", "permsAllow", "permsDeny")
    .where({ idEmpresa, idUsuario })
    .first();

  const role = toRole(base?.role);
  const allow = parseList(base?.permsAllow);
  const deny = parseList(base?.permsDeny);

  const perms = calcEffectivePerms(role, allow, deny);
  cache.set(key, { at: now, perms });
  return perms;
}

// — middleware —

export function requirePerm(key: Perm) {
  return async (req: any, reply: FastifyReply) => {
    try {
      const perms = await getEffectivePerms(req.user.idEmpresa, req.user.idUsuario);
      if (!perms.includes(key)) {
        return reply.code(403).send({ message: "Permissão negada", key });
      }
    } catch (e) {
      // Em dúvida: negar de forma segura
      return reply.code(403).send({ message: "Permissão negada", key });
    }
  };
}
