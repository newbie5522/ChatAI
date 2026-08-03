"use client";

import { useMemo } from "react";

import type { ModelProvider } from "../config/model-registry";
import { useAccountStore } from "../store/account";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import BotIconClaude from "../icons/llm-icons/claude.svg";
import BotIconGemini from "../icons/llm-icons/gemini.svg";
import BotIconPerplexity from "../icons/llm-icons/perplexity.svg";
import BotIconGrok from "../icons/llm-icons/grok.svg";
import BotIconDeepseek from "../icons/llm-icons/deepseek.svg";
import BotIconQwen from "../icons/llm-icons/qwen.svg";
import BotIconMistral from "../icons/llm-icons/mistral.svg";
import BotIconChatglm from "../icons/llm-icons/chatglm.svg";

const PROVIDER_ALIASES: Record<string, ModelProvider> = {
  openai: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  google: "google",
  gemini: "google",
  perplexity: "perplexity",
  xai: "xai",
  deepseek: "deepseek",
  qwen: "qwen",
  mistral: "mistral",
  zhipu: "zhipu",
  "智谱 glm": "zhipu",
};

const ICONS = {
  openai: BotIconOpenAI,
  anthropic: BotIconClaude,
  google: BotIconGemini,
  perplexity: BotIconPerplexity,
  xai: BotIconGrok,
  deepseek: BotIconDeepseek,
  qwen: BotIconQwen,
  mistral: BotIconMistral,
  zhipu: BotIconChatglm,
} satisfies Record<ModelProvider, typeof BotIconOpenAI>;

function normalizedProvider(providerName?: string) {
  return providerName
    ? PROVIDER_ALIASES[providerName.trim().toLowerCase()]
    : undefined;
}

function historicalProvider(model?: string): ModelProvider | undefined {
  const name = model?.toLowerCase() ?? "";
  if (/^(gpt|chatgpt|dall-e|o[134])|gpt-image/.test(name)) return "openai";
  if (name.startsWith("claude")) return "anthropic";
  if (name.startsWith("gemini") || name.includes("nano-banana"))
    return "google";
  if (name.startsWith("sonar")) return "perplexity";
  if (name.startsWith("grok")) return "xai";
  if (name.includes("deepseek")) return "deepseek";
  if (name.startsWith("qwen")) return "qwen";
  if (name.includes("mistral") || name.includes("mixtral")) return "mistral";
  if (name.includes("glm")) return "zhipu";
  return undefined;
}

export function ProviderAvatar(props: {
  providerName?: string;
  model?: string;
  size?: number;
}) {
  const models = useAccountStore((state) => state.models);
  const provider = useMemo(() => {
    const explicit = normalizedProvider(props.providerName);
    if (explicit) return explicit;
    if (props.model) {
      const matches = models.filter((item) => item.name === props.model);
      const uniqueProviders = new Set(
        matches.map((item) => item.provider.providerType),
      );
      if (uniqueProviders.size === 1) {
        return normalizedProvider([...uniqueProviders][0]);
      }
      if (matches.length > 0) return undefined;
    }
    return historicalProvider(props.model);
  }, [models, props.model, props.providerName]);
  const size = props.size ?? 30;
  if (!provider) {
    return (
      <img
        className="user-avatar"
        src="/newbiechat-logo.svg"
        width={size}
        height={size}
        alt="NewbieChat"
      />
    );
  }
  const Icon = ICONS[provider];
  return (
    <div className="no-dark">
      <Icon className="user-avatar" width={size} height={size} />
    </div>
  );
}
