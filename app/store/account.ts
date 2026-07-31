import { create } from "zustand";

import type { LLMModel } from "../client/api";
import type { ModelCategory } from "../config/model-registry";

export type AccountRole = "employee" | "admin" | "super_admin";

export interface AccountSessionUser {
  userId: string;
  username: string;
  name: string;
  role: AccountRole;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
  quotaUnlimited: boolean;
  monthlyChatTurns?: number;
  monthlySearchTurns?: number;
  monthlyImageCount?: number;
  monthlyVideoCount?: number;
}

interface AccountSessionResponse {
  error?: boolean;
  message?: string;
  authenticated: boolean;
  user: AccountSessionUser | null;
  models: LLMModel[];
}

const ACCOUNT_ROLES: AccountRole[] = ["employee", "admin", "super_admin"];
const MODEL_CATEGORIES: ModelCategory[] = ["chat", "search", "image", "video"];

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isAccountSessionUser(value: unknown): value is AccountSessionUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.userId === "string" &&
    typeof user.username === "string" &&
    typeof user.name === "string" &&
    ACCOUNT_ROLES.includes(user.role as AccountRole) &&
    isStringArray(user.allowedModelIds) &&
    Array.isArray(user.allowedCategories) &&
    user.allowedCategories.every((category) =>
      MODEL_CATEGORIES.includes(category as ModelCategory),
    ) &&
    typeof user.quotaUnlimited === "boolean" &&
    (user.monthlyChatTurns === undefined ||
      typeof user.monthlyChatTurns === "number") &&
    (user.monthlySearchTurns === undefined ||
      typeof user.monthlySearchTurns === "number") &&
    (user.monthlyImageCount === undefined ||
      typeof user.monthlyImageCount === "number") &&
    (user.monthlyVideoCount === undefined ||
      typeof user.monthlyVideoCount === "number")
  );
}

function isSessionModel(value: unknown): value is LLMModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  if (!model.provider || typeof model.provider !== "object") return false;
  const provider = model.provider as Record<string, unknown>;
  return (
    typeof model.name === "string" &&
    (model.displayName === undefined ||
      typeof model.displayName === "string") &&
    (model.category === undefined ||
      MODEL_CATEGORIES.includes(model.category as ModelCategory)) &&
    typeof model.available === "boolean" &&
    typeof model.sorted === "number" &&
    typeof provider.id === "string" &&
    typeof provider.providerName === "string" &&
    typeof provider.providerType === "string" &&
    typeof provider.sorted === "number"
  );
}

function parseSession(value: unknown): AccountSessionResponse | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  if (
    typeof session.authenticated !== "boolean" ||
    !Array.isArray(session.models) ||
    !session.models.every(isSessionModel)
  ) {
    return null;
  }

  if (session.authenticated) {
    if (!isAccountSessionUser(session.user)) return null;
  } else if (session.user !== null) {
    return null;
  }

  return {
    error: typeof session.error === "boolean" ? session.error : undefined,
    message: typeof session.message === "string" ? session.message : undefined,
    authenticated: session.authenticated,
    user: session.user as AccountSessionUser | null,
    models: session.models,
  };
}

async function readResponse(res: Response) {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("服务器返回了无效响应");
  }

  const session = parseSession(body);
  if (!session) {
    const message =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).message === "string"
        ? String((body as Record<string, unknown>).message)
        : "服务器返回了无效响应";
    throw new Error(message);
  }
  return session;
}

function clearedSession(error = ""): Partial<AccountState> {
  return {
    loaded: true,
    fetching: false,
    authenticated: false,
    user: null,
    models: [],
    error,
  };
}

interface AccountState {
  loaded: boolean;
  fetching: boolean;
  authenticated: boolean;
  user: AccountSessionUser | null;
  models: LLMModel[];
  error: string;
  isAdmin: () => boolean;
  fetchSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function applySession(set: (state: Partial<AccountState>) => void) {
  return (session: AccountSessionResponse) => {
    set({
      loaded: true,
      fetching: false,
      authenticated: session.authenticated,
      user: session.user,
      models: Array.isArray(session.models) ? session.models : [],
      error: "",
    });
  };
}

export const useAccountStore = create<AccountState>((set, get) => ({
  loaded: false,
  fetching: false,
  authenticated: false,
  user: null,
  models: [],
  error: "",

  isAdmin() {
    const role = get().user?.role;
    return role === "admin" || role === "super_admin";
  },

  async fetchSession() {
    if (get().fetching) return;
    set({ fetching: true });
    try {
      const res = await fetch("/api/account/session", {
        method: "GET",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        set(clearedSession());
        return;
      }
      const session = await readResponse(res);
      if (!res.ok || session.error) {
        throw new Error(session.message ?? "会话加载失败");
      }
      applySession(set)(session);
    } catch (error) {
      set(
        clearedSession(error instanceof Error ? error.message : String(error)),
      );
    }
  },

  async login(username: string, password: string) {
    set({
      fetching: true,
      authenticated: false,
      user: null,
      models: [],
      error: "",
    });
    try {
      const res = await fetch("/api/account/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const session = await readResponse(res);
      if (!res.ok || session.error) {
        throw new Error(session.message ?? "登录失败");
      }
      applySession(set)(session);
    } catch (error) {
      set(
        clearedSession(error instanceof Error ? error.message : String(error)),
      );
      throw error;
    }
  },

  async logout() {
    try {
      await fetch("/api/account/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      set(clearedSession());
    }
  },
}));
