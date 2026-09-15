import { ServiceProvider } from "@/app/constant";
import { ModalConfigValidator, ModelConfig } from "../store";

import Locale from "../locales";
import { ListItem, Select } from "./ui-lib";
import { useAllModels } from "../utils/hooks";
import { getModelProvider } from "../utils/model";
import type { LLMModel } from "../client/api";

type SelectableModel = Omit<LLMModel, "provider"> & {
  provider?: LLMModel["provider"];
};

export const MODEL_GROUPS = [
  {
    category: "chat",
    title: "聊天",
    emptyText: "暂无可用模型",
  },
  {
    category: "search",
    title: "搜索",
    emptyText: "暂无可用模型",
  },
  {
    category: "image",
    title: "生图",
    emptyText: "暂无可用模型",
  },
  {
    category: "video",
    title: "视频",
    emptyText: "待加入",
  },
] as const;

export function sortModels(models: SelectableModel[]) {
  return models.slice().sort((a, b) => {
    const sortDiff = (a.sorted ?? 9999) - (b.sorted ?? 9999);
    if (sortDiff !== 0) return sortDiff;

    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
  });
}

export function getGroupedModels(models: SelectableModel[]) {
  return MODEL_GROUPS.map((group) => ({
    ...group,
    models: sortModels(
      models.filter((model) => model.category === group.category),
    ),
  }));
}

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
}) {
  const allModels = useAllModels();
  const groupedModels = getGroupedModels(allModels.filter((v) => v.available));
  const modelValues = new Set(
    allModels.map((model) => `${model.name}@${model.provider?.providerName}`),
  );
  const requestedValue = `${props.modelConfig.model}@${props.modelConfig?.providerName}`;
  const value = modelValues.has(requestedValue) ? requestedValue : "";

  return (
    <>
      <ListItem title={Locale.Settings.Model}>
        <Select
          aria-label={Locale.Settings.Model}
          value={value}
          align="left"
          onChange={(e) => {
            const [model, providerName] = getModelProvider(
              e.currentTarget.value,
            );
            props.updateConfig((config) => {
              config.model = ModalConfigValidator.model(model);
              config.providerName = providerName as ServiceProvider;
            });
          }}
        >
          {value === "" && (
            <option value="" disabled>
              暂无可用模型
            </option>
          )}
          {groupedModels.map((group) => (
            <optgroup label={group.title} key={group.category}>
              {group.models.length === 0 ? (
                <option
                  disabled
                  value={`__empty_${group.category}`}
                  key={`${group.category}-empty`}
                >
                  {group.emptyText}
                </option>
              ) : (
                group.models.map((v) => (
                  <option
                    value={`${v.name}@${v.provider?.providerName}`}
                    key={`${v.provider?.providerName}:${v.name}`}
                  >
                    {v.displayName || v.name} ({v.provider?.providerName})
                  </option>
                ))
              )}
            </optgroup>
          ))}
        </Select>
      </ListItem>
    </>
  );
}
