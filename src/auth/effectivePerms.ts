// src/auth/effectivePerms.ts
import { ROLE_PERMS, Role, Perm } from "./permissions.js";

export function calcEffectivePerms(role: Role, allow?: string | null, deny?: string | null): Perm[] {
  const base = new Set<Perm>(ROLE_PERMS[role] ?? []);
  const allowArr: Perm[] = parseJSONArr(allow);
  const denyArr:  Perm[] = parseJSONArr(deny);

  for (const p of allowArr) base.add(p);
  for (const p of denyArr)  base.delete(p);

  return [...base];
}

function parseJSONArr(v?: string | null): any[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
