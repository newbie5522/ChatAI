import {
  COMPANY_API_PATH,
  DEFAULT_MODELS,
  OpenaiPath,
  Perplexity,
  ServiceProvider,
} from "@/app/constant";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";

import { ChatGPTApi } from "./openai";
import { LLMModel, LLMUsage, SpeechOptions } from "../api";

export class PerplexityApi extends ChatGPTApi {
  path(path: string): string {
    const providerPath =
      path === OpenaiPath.ChatPath ? Perplexity.ChatPath : path;
    const baseUrl = COMPANY_API_PATH.Perplexity;

    console.log("[Proxy Endpoint] ", baseUrl, providerPath);
    return cloudflareAIGatewayUrl([baseUrl, providerPath].join("/"));
  }

  speech(_options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Perplexity speech is not implemented.");
  }

  usage(): Promise<LLMUsage> {
    throw new Error("Perplexity usage is not implemented.");
  }

  async models(): Promise<LLMModel[]> {
    return DEFAULT_MODELS.filter(
      (model) => model.provider.providerName === ServiceProvider.Perplexity,
    ) as LLMModel[];
  }
}
