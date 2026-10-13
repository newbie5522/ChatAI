/**
 * RBAC 权限检查工具
 *
 * 角色权限矩阵：
 * - employee：chat, media:image（如果模型允许）
 * - admin：employee 权限 + admin:audit（自己账号下的）
 * - super_admin：全部资源
 */

import type { SafeAccountRecord } from "@/app/config/admin-store";

export type RbacResource =
  | "chat"
  | "media:image"
  | "media:video"
  | "admin:audit"
  | "admin:users";

const EMPLOYEE_RESOURCES: RbacResource[] = ["chat", "media:image"];
const ADMIN_RESOURCES: RbacResource[] = [
  "chat",
  "media:image",
  "media:video",
  "admin:audit",
];
const SUPER_ADMIN_RESOURCES: RbacResource[] = [
  "chat",
  "media:image",
  "media:video",
  "admin:audit",
  "admin:users",
];

/**
 * 检查账号是否有权访问指定资源
 */
export function checkPermission(
  account: SafeAccountRecord,
  resource: string,
): boolean {
  if (account.status !== "active") return false;
  const allowed = getAllowedResources(account);
  return allowed.includes(resource as RbacResource);
}

/**
 * 获取账号可访问的资源列表
 */
export function getAllowedResources(account: SafeAccountRecord): string[] {
  if (account.status !== "active") return [];

  switch (account.role) {
    case "super_admin":
      return [...SUPER_ADMIN_RESOURCES];
    case "admin":
      return [...ADMIN_RESOURCES];
    case "employee":
    default:
      return [...EMPLOYEE_RESOURCES];
  }
}
