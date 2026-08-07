import {
  GoogleSafetySettingsThreshold,
  ServiceProvider,
  StoreKey,
  ApiPath,
  OPENAI_BASE_URL,
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  ALIBABA_BASE_URL,
  STABILITY_BASE_URL,
  DEEPSEEK_BASE_URL,
  XAI_BASE_URL,
  CHATGLM_BASE_URL,
} from "../constant";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
import { ensure } from "../utils/clone";
import { DEFAULT_CONFIG } from "./config";
import { getModelProvider } from "../utils/model";
import { useAccountStore } from "./account";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;

const DEFAULT_GOOGLE_URL = isApp ? GEMINI_BASE_URL : ApiPath.Google;

const DEFAULT_ANTHROPIC_URL = isApp ? ANTHROPIC_BASE_URL : ApiPath.Anthropic;

const DEFAULT_ALIBABA_URL = isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;

const DEFAULT_STABILITY_URL = isApp ? STABILITY_BASE_URL : ApiPath.Stability;

const DEFAULT_DEEPSEEK_URL = isApp ? DEEPSEEK_BASE_URL : ApiPath.DeepSeek;

const DEFAULT_XAI_URL = isApp ? XAI_BASE_URL : ApiPath.XAI;

const DEFAULT_CHATGLM_URL = isApp ? CHATGLM_BASE_URL : ApiPath.ChatGLM;

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  useCustomConfig: false,

  provider: ServiceProvider.OpenAI,

  // openai
  openaiUrl: DEFAULT_OPENAI_URL,
  openaiApiKey: "",

  // azure
  azureUrl: "",
  azureApiKey: "",
  azureApiVersion: "2023-08-01-preview",

  // google ai studio
  googleUrl: DEFAULT_GOOGLE_URL,
  googleApiKey: "",
  googleApiVersion: "v1",
  googleSafetySettings: GoogleSafetySettingsThreshold.BLOCK_ONLY_HIGH,

  // anthropic
  anthropicUrl: DEFAULT_ANTHROPIC_URL,
  anthropicApiKey: "",
  anthropicApiVersion: "2023-06-01",

  // alibaba
  alibabaUrl: DEFAULT_ALIBABA_URL,
  alibabaApiKey: "",

  //stability
  stabilityUrl: DEFAULT_STABILITY_URL,
  stabilityApiKey: "",

  // deepseek
  deepseekUrl: DEFAULT_DEEPSEEK_URL,
  deepseekApiKey: "",

  // xai
  xaiUrl: DEFAULT_XAI_URL,
  xaiApiKey: "",

  // chatglm
  chatglmUrl: DEFAULT_CHATGLM_URL,
  chatglmApiKey: "",

  // server config
  needCode: true,
  employeeAccessEnabled: false,
  hideUserApiKey: true,
  hideBalanceQuery: false,
  disableGPT4: false,
  disableFastLink: true,
  customModels: "",
  defaultModel: "",
  visionModels: "",

  // tts config
  edgeTTSVoiceName: "zh-CN-YunxiNeural",
};

const EMPTY_PROVIDER_KEYS = {
  useCustomConfig: false,
  openaiApiKey: "",
  azureApiKey: "",
  googleApiKey: "",
  anthropicApiKey: "",
  alibabaApiKey: "",
  stabilityApiKey: "",
  deepseekApiKey: "",
  xaiApiKey: "",
  chatglmApiKey: "",
};

function clearProviderKeys() {
  return { ...EMPTY_PROVIDER_KEYS };
}

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      this.fetch();

      return get().needCode;
    },
    getVisionModels() {
      this.fetch();
      return get().visionModels;
    },
    edgeVoiceName() {
      this.fetch();

      return get().edgeTTSVoiceName;
    },

    isValidOpenAI() {
      return ensure(get(), ["openaiApiKey"]);
    },

    isValidAzure() {
      return ensure(get(), ["azureUrl", "azureApiKey", "azureApiVersion"]);
    },

    isValidGoogle() {
      return ensure(get(), ["googleApiKey"]);
    },

    isValidAnthropic() {
      return ensure(get(), ["anthropicApiKey"]);
    },

    isValidAlibaba() {
      return ensure(get(), ["alibabaApiKey"]);
    },

    isValidDeepSeek() {
      return ensure(get(), ["deepseekApiKey"]);
    },

    isValidXAI() {
      return ensure(get(), ["xaiApiKey"]);
    },

    isValidChatGLM() {
      return ensure(get(), ["chatglmApiKey"]);
    },

    isAuthorized() {
      this.fetch();
      if (useAccountStore.getState().authenticated) return true;

      const allowUserProviderKey = !get().hideUserApiKey;
      const hasUserProviderKey =
        allowUserProviderKey &&
        (this.isValidOpenAI() ||
          this.isValidAzure() ||
          this.isValidGoogle() ||
          this.isValidAnthropic() ||
          this.isValidAlibaba() ||
          this.isValidDeepSeek() ||
          this.isValidXAI() ||
          this.isValidChatGLM() ||
          this.isValidDeepSeek() ||
          this.isValidXAI() ||
          this.isValidChatGLM());

      // has token or has code or disabled access control
      return (
        hasUserProviderKey ||
        !this.enabledAccessControl() ||
        (this.enabledAccessControl() && ensure(get(), ["accessCode"]))
      );
    },
    fetch() {
      if (fetchState > 0 || getClientConfig()?.buildMode === "export") return;
      fetchState = 1;
      fetch("/api/config", {
        method: "post",
        body: null,
        headers: {
          ...getHeaders(),
        },
      })
        .then((res) => res.json())
        .then((res) => {
          const defaultModel = res.defaultModel ?? "";
          if (defaultModel !== "") {
            const [model, providerName] = getModelProvider(defaultModel);
            DEFAULT_CONFIG.modelConfig.model = model;
            DEFAULT_CONFIG.modelConfig.providerName = providerName as any;
          }

          return res;
        })
        .then((res: DangerConfig) => {
          console.log("[Config] got config from server", res);
          set(() => ({
            ...res,
            ...(res.hideUserApiKey ? clearProviderKeys() : {}),
          }));
        })
        .catch(() => {
          console.error("[Config] failed to fetch config");
        })
        .finally(() => {
          fetchState = 2;
        });
    },
  }),
  {
    name: StoreKey.Access,
    version: 2,
    migrate(persistedState, version) {
      if (version < 2) {
        const state = persistedState as {
          token: string;
          openaiApiKey: string;
          azureApiVersion: string;
          googleApiKey: string;
        };
        state.openaiApiKey = "";
        state.googleApiKey = "";
        state.azureApiVersion = "2023-08-01-preview";
      }

      return persistedState as any;
    },
  },
);
