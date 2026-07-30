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
  monthlyQuota?: number;
  usedQuota?: number;
}

interface AccountSessionResponse {
  error?: boolean;
  message?: string;
  authenticated: boolean;
  user: AccountSessionUser | null;
  models: LLMModel[];
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
      models: session.models ?? [],
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
      const session = (await res.json()) as AccountSessionResponse;
      applySession(set)(session);
    } catch (error) {
      set({
        loaded: true,
        fetching: false,
        authenticated: false,
        user: null,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async login(username: string, password: string) {
    set({ fetching: true, error: "" });
    const res = await fetch("/api/account/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const session = (await res.json()) as AccountSessionResponse;
    if (!res.ok || session.error) {
      set({ fetching: false, error: session.message ?? "login failed" });
      throw new Error(session.message ?? "login failed");
    }
    applySession(set)(session);
  },

  async logout() {
    await fetch("/api/account/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    set({
      loaded: true,
      fetching: false,
      authenticated: false,
      user: null,
      models: [],
      error: "",
    });
  },
}));
