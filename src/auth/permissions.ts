// src/auth/permissions.ts
export type Role = "ADMIN" | "MANAGER" | "USER";
export type Perm =
  | "documents:view" | "documents:download"
  | "documents:archive" | "documents:unarchive" | "documents:delete"
  | "trash:view" | "trash:restore" | "trash:purge"
  | "departments:view" | "departments:create" | "departments:update"
  | "users:view" | "users:create" | "users:update"
  | "dashboard:view";

export const ROLE_PERMS: Record<Role, Perm[]> = {
  ADMIN: [
    "dashboard:view",
    "documents:view","documents:download","documents:archive","documents:unarchive","documents:delete",
    "trash:view","trash:restore","trash:purge",
    "departments:view","departments:create","departments:update",
    "users:view","users:create","users:update",
  ],
  MANAGER: [
    "dashboard:view",
    "documents:view","documents:download","documents:archive","documents:unarchive","documents:delete",
    "trash:view","trash:restore","trash:purge",
    "departments:view","departments:create","departments:update",
    "users:view","users:create","users:update",
  ],
  USER: [
    "dashboard:view",
    "documents:view","documents:download",
    "departments:view",
  ],
};
