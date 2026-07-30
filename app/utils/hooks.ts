import { useMemo } from "react";
import { useAccessStore, useAccountStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const accountStore = useAccountStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    if (accountStore.authenticated && accountStore.models.length > 0) {
      return accountStore.models.filter(
        (model) => !!model?.name && !!model?.provider?.providerName,
      ) as ReturnType<typeof collectModelsWithDefaultModel>;
    }

    return collectModelsWithDefaultModel(
      configStore.models.filter(
        (model) => !!model?.name && !!model?.provider?.providerName,
      ),
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    ).filter((model) => !!model?.name && !!model?.provider?.providerName);
  }, [
    accountStore.authenticated,
    accountStore.models,
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}
