import { useMemo } from "react";
import { useAccountStore } from "../store";
import type { LLMModel } from "../client/api";

export function useAllModels() {
  const accountStore = useAccountStore();
  const models = useMemo(() => {
    if (!accountStore.loaded || !accountStore.authenticated) return [];

    return accountStore.models.filter(
      (model): model is LLMModel =>
        !!model &&
        typeof model.name === "string" &&
        model.name.trim().length > 0 &&
        !!model.provider &&
        typeof model.provider.providerName === "string" &&
        model.provider.providerName.trim().length > 0,
    );
  }, [accountStore.authenticated, accountStore.loaded, accountStore.models]);

  return models;
}
