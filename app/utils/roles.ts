import type { AccountRole, AccountStatus } from "../config/admin-store";
import type { ModelCategory } from "../config/model-registry";

export function getRoleDisplayName(role?: AccountRole | string) {
  if (role === "super_admin") return "超级管理员";
  if (role === "admin") return "管理员";
  return "成员";
}

export function getAccountStatusDisplayName(status?: AccountStatus | string) {
  return status === "disabled" ? "已禁用" : "正常";
}

export function getCategoryDisplayName(category?: ModelCategory | string) {
  const names: Record<ModelCategory, string> = {
    chat: "聊天",
    search: "搜索",
    image: "生图",
    video: "视频",
  };
  return names[category as ModelCategory] ?? "未知分类";
}
