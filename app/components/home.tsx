"use client";

require("../polyfill");

import { useEffect, useState } from "react";
import styles from "./home.module.scss";

import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";

import { getCSSVar, useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  HashRouter as Router,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import {
  useAccessStore,
  useAccountStore,
  useAppConfig,
  useChatStore,
} from "../store";
import { AuthPage } from "./auth";
import { getClientConfig } from "../config/client";
import { type ClientApi, getClientApi } from "../client/api";
import clsx from "clsx";
import { initializeMcpSystem, isMcpEnabled } from "../mcp/actions";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={clsx("no-dark", styles["loading-content"])}>
      {!props.noLogo && <BotIcon />}
      <LoadingIcon />
    </div>
  );
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <Loading noLogo />,
});

const Settings = dynamic(async () => (await import("./settings")).Settings, {
  loading: () => <Loading noLogo />,
});

const AdminPage = dynamic(async () => (await import("./admin")).AdminPage, {
  loading: () => <Loading noLogo />,
});

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
});

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <Loading noLogo />,
});

const MaskPage = dynamic(async () => (await import("./mask")).MaskPage, {
  loading: () => <Loading noLogo />,
});

const PluginPage = dynamic(async () => (await import("./plugin")).PluginPage, {
  loading: () => <Loading noLogo />,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  {
    loading: () => <Loading noLogo />,
  },
);

const Sd = dynamic(async () => (await import("./sd")).Sd, {
  loading: () => <Loading noLogo />,
});

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  {
    loading: () => <Loading noLogo />,
  },
);

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncGoogleFont = () => {
  const linkEl = document.createElement("link");
  const proxyFontUrl = "/google-fonts";
  const remoteFontUrl = "https://fonts.googleapis.com";
  const googleFontUrl =
    getClientConfig()?.buildMode === "export" ? remoteFontUrl : proxyFontUrl;
  linkEl.rel = "stylesheet";
  linkEl.href =
    googleFontUrl +
    "/css2?family=" +
    encodeURIComponent("Noto Sans:wght@300;400;700;900") +
    "&display=swap";
  document.head.appendChild(linkEl);
};

export function WindowContent(props: { children: React.ReactNode }) {
  return (
    <div className={styles["window-content"]} id={SlotID.AppBody}>
      {props?.children}
    </div>
  );
}

function Screen() {
  const config = useAppConfig();
  const chatStore = useChatStore();
  const accountStore = useAccountStore();
  const location = useLocation();
  const navigate = useNavigate();
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isAdmin = location.pathname === Path.Admin;
  const isSd = location.pathname === Path.Sd;
  const isSdNew = location.pathname === Path.SdNew;
  const currentSessionIndex = chatStore.currentSessionIndex;
  const currentSession = chatStore.sessions[currentSessionIndex];
  const currentSessionModel = currentSession?.mask.modelConfig.model ?? "";
  const currentSessionProvider =
    currentSession?.mask.modelConfig.providerName ?? "";

  const isMobileScreen = useMobileScreen();
  const shouldTightBorder =
    getClientConfig()?.isApp || (config.tightBorder && !isMobileScreen);

  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  useEffect(() => {
    void accountStore.fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      accountStore.loaded &&
      !accountStore.authenticated &&
      !isAuth &&
      !isArtifact
    ) {
      navigate(Path.Auth);
    }
  }, [
    accountStore.authenticated,
    accountStore.loaded,
    isArtifact,
    isAuth,
    navigate,
  ]);

  useEffect(() => {
    if (!accountStore.loaded || !accountStore.authenticated) return;

    const allowedModels = accountStore.models.filter(
      (model) => !!model?.name && !!model?.provider?.providerName,
    );
    const session = chatStore.sessions[currentSessionIndex];
    if (!session) return;

    if (allowedModels.length === 0) {
      if (config.modelConfig.model || config.modelConfig.providerName) {
        config.update((state) => {
          state.modelConfig.model = "";
          state.modelConfig.providerName = "" as any;
        });
      }
      if (
        session.mask.modelConfig.model ||
        session.mask.modelConfig.providerName
      ) {
        chatStore.updateTargetSession(session, (target) => {
          target.mask.modelConfig.model = "";
          target.mask.modelConfig.providerName = "" as any;
        });
      }
      return;
    }

    const currentAllowed = allowedModels.some(
      (model) =>
        model.name === currentSessionModel &&
        model.provider.providerName === currentSessionProvider,
    );
    const nextModel = currentAllowed
      ? {
          name: currentSessionModel,
          provider: { providerName: currentSessionProvider },
        }
      : allowedModels[0];

    if (
      config.modelConfig.model !== nextModel.name ||
      config.modelConfig.providerName !== nextModel.provider.providerName
    ) {
      config.update((state) => {
        state.modelConfig.model = nextModel.name;
        state.modelConfig.providerName = nextModel.provider.providerName as any;
      });
    }
    if (!currentAllowed) {
      chatStore.updateTargetSession(session, (target) => {
        target.mask.modelConfig.model = nextModel.name;
        target.mask.modelConfig.providerName = nextModel.provider
          .providerName as any;
      });
    }
  }, [
    accountStore.authenticated,
    accountStore.loaded,
    accountStore.models,
    chatStore,
    config,
    config.modelConfig.providerName,
    config.modelConfig.model,
    currentSessionIndex,
    currentSessionModel,
    currentSessionProvider,
  ]);

  if (isArtifact) {
    return (
      <Routes>
        <Route path="/artifacts/:id" element={<Artifacts />} />
      </Routes>
    );
  }
  const renderContent = () => {
    if (isAuth) return <AuthPage />;
    if (isSd) return <Sd />;
    if (isSdNew) return <Sd />;
    return (
      <>
        {!isAdmin && (
          <SideBar
            className={clsx({
              [styles["sidebar-show"]]: isHome,
            })}
          />
        )}
        <WindowContent>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.NewChat} element={<NewChat />} />
            <Route path={Path.Masks} element={<MaskPage />} />
            <Route path={Path.Plugins} element={<PluginPage />} />
            <Route path={Path.SearchChat} element={<SearchChat />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.Settings} element={<Settings />} />
            <Route path={Path.Admin} element={<AdminPage />} />
            <Route path={Path.McpMarket} element={<McpMarketPage />} />
          </Routes>
        </WindowContent>
      </>
    );
  };

  return (
    <div
      className={clsx(styles.container, {
        [styles["tight-container"]]: shouldTightBorder && !isAuth && !isAdmin,
        [styles["auth-container"]]: isAuth,
        [styles["admin-container"]]: isAdmin,
        [styles["rtl-screen"]]: getLang() === "ar",
      })}
    >
      {renderContent()}
    </div>
  );
}

export function useLoadData() {
  const config = useAppConfig();

  const api: ClientApi = getClientApi(config.modelConfig.providerName);

  useEffect(() => {
    (async () => {
      const models = await api.llm.models();
      config.mergeModels(models);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Home() {
  useSwitchTheme();
  useLoadData();
  useHtmlLang();

  useEffect(() => {
    console.log("[Config] got config from build time", getClientConfig());
    useAccessStore.getState().fetch();

    const initMcp = async () => {
      try {
        const enabled = await isMcpEnabled();
        if (enabled) {
          console.log("[MCP] initializing...");
          await initializeMcpSystem();
          console.log("[MCP] initialized");
        }
      } catch (err) {
        console.error("[MCP] failed to initialize:", err);
      }
    };
    initMcp();
  }, []);

  if (!useHasHydrated()) {
    return <Loading />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <Screen />
      </Router>
    </ErrorBoundary>
  );
}
