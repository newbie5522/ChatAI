"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ModelCategory, ModelProvider } from "../config/model-registry";
import { Path } from "../constant";
import { useAccountStore } from "../store";
import {
  getAccountStatusDisplayName,
  getCategoryDisplayName,
  getRoleDisplayName,
} from "../utils/roles";
import { IconButton } from "./button";
import { Modal, showToast } from "./ui-lib";
import styles from "./admin.module.scss";

type AccountRole = "employee" | "admin" | "super_admin";
type AdminTab = "members" | "providers" | "models" | "logs";

interface AdminAccount {
  id: string;
  username: string;
  name: string;
  role: AccountRole;
  status: "active" | "disabled";
  quotaUnlimited: boolean;
  monthlyChatTurns?: number;
  monthlySearchTurns?: number;
  monthlyImageCount?: number;
  monthlyVideoCount?: number;
  usedChatTurns: number;
  usedSearchTurns: number;
  usedImageCount: number;
  usedVideoCount: number;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
  lastLoginAt?: string;
}

interface AdminCredential {
  id: string;
  provider: ModelProvider;
  keyConfigured: boolean;
  keyPreview: string;
  enabled: boolean;
  priority: number;
  baseUrl?: string;
  useCompatibleMode: boolean;
  categoryScope: ModelCategory | "all";
  name?: string;
}

interface AdminModel {
  id: string;
  provider: ModelProvider;
  category: ModelCategory;
  displayName: string;
  model: string;
  endpointType: string;
  enabled: boolean;
  adminOnly?: boolean;
  sort: number;
  hasUsableCredential: boolean;
}

interface UsageRecord {
  id: string;
  accountId: string;
  username: string;
  role: string;
  provider: string;
  modelId: string;
  model: string;
  modelDisplayName?: string;
  category: ModelCategory;
  promptPreview: string;
  promptContent?: string;
  status: string;
  errorMessage?: string;
  createdAt: string;
}

interface AccountForm {
  id?: string;
  username: string;
  name: string;
  password: string;
  role: AccountRole;
  quotaUnlimited: boolean;
  monthlyChatTurns: string;
  monthlySearchTurns: string;
  monthlyImageCount: string;
  monthlyVideoCount: string;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
}

interface ProviderForm {
  id?: string;
  provider: ModelProvider;
  apiKey: string;
  baseUrl?: string;
  keyConfigured: boolean;
  enabled: boolean;
  useCompatibleMode: boolean;
  categoryScope: ModelCategory | "all";
}

type QuotaFormField =
  | "monthlyChatTurns"
  | "monthlySearchTurns"
  | "monthlyImageCount"
  | "monthlyVideoCount";

const QUOTA_FORM_FIELDS: Array<{
  label: string;
  field: QuotaFormField;
  unit: string;
}> = [
  { label: "聊天额度", field: "monthlyChatTurns", unit: "轮/月" },
  { label: "搜索额度", field: "monthlySearchTurns", unit: "轮/月" },
  { label: "生图额度", field: "monthlyImageCount", unit: "张/月" },
  { label: "视频额度", field: "monthlyVideoCount", unit: "个/月" },
];

const PROVIDERS: ModelProvider[] = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "xai",
  "deepseek",
  "qwen",
  "mistral",
  "zhipu",
];

const PROVIDER_NAMES: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  google: "Google",
  perplexity: "Perplexity",
  xai: "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistral: "Mistral",
  zhipu: "智谱 GLM",
};

const CATEGORIES: ModelCategory[] = ["chat", "search", "image", "video"];

const CATEGORY_SCOPE_OPTIONS: Array<{ value: ModelCategory | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "chat", label: "对话" },
  { value: "image", label: "图片" },
  { value: "search", label: "搜索" },
  { value: "video", label: "视频" },
];

function getCategoryScopeLabel(scope: ModelCategory | "all"): string {
  return CATEGORY_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? "全部";
}

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "members", label: "成员" },
  { id: "providers", label: "服务商" },
  { id: "models", label: "模型" },
  { id: "logs", label: "日志" },
];

function emptyAccountForm(): AccountForm {
  return {
    username: "",
    name: "",
    password: "",
    role: "employee",
    quotaUnlimited: true,
    monthlyChatTurns: "500",
    monthlySearchTurns: "100",
    monthlyImageCount: "50",
    monthlyVideoCount: "10",
    allowedModelIds: [],
    allowedCategories: ["chat"],
  };
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.message ?? "管理请求失败");
  }
  return body as T;
}

function formatDate(value?: string) {
  if (!value) return "从未登录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "从未登录"
    : date.toLocaleString("zh-CN");
}

function getLogStatus(status: string) {
  if (status === "pending") return "处理中";
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "blocked") return "已阻止";
  if (status === "canceled") return "已取消";
  return status || "-";
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function AdminPanel() {
  const navigate = useNavigate();
  const accountStore = useAccountStore();
  const isSuperAdmin = accountStore.user?.role === "super_admin";
  const [activeTab, setActiveTab] = useState<AdminTab>("members");
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [processingAccountId, setProcessingAccountId] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingModelIds, setSavingModelIds] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [message, setMessage] = useState("");
  const [accountFormError, setAccountFormError] = useState("");
  const [providerFormError, setProviderFormError] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [credentials, setCredentials] = useState<AdminCredential[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null);
  const [resetAccount, setResetAccount] = useState<AdminAccount | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderForm | null>(null);
  const [logMonth, setLogMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [logAccountId, setLogAccountId] = useState("");

  const modelsByCategory = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        models: models
          .filter((model) => model.category === category)
          .sort((a, b) => a.sort - b.sort),
      })),
    [models],
  );

  const visiblePermissionModels = useMemo(
    () =>
      models
        .filter(
          (model) =>
            model.endpointType !== "not_implemented" &&
            model.enabled &&
            !model.adminOnly,
        )
        .sort((a, b) => a.sort - b.sort),
    [models],
  );

  const extraPermissionModels = useMemo(
    () =>
      accountForm
        ? visiblePermissionModels.filter(
            (model) => !accountForm.allowedCategories.includes(model.category),
          )
        : [],
    [accountForm, visiblePermissionModels],
  );

  const currentPermissionSummary = useMemo(() => {
    if (!accountForm || accountForm.role !== "employee") return [];
    const categoryPermissions = accountForm.allowedCategories.map(
      (category) => `全部${getCategoryDisplayName(category)}模型`,
    );
    const modelPermissions = visiblePermissionModels
      .filter(
        (model) =>
          accountForm.allowedModelIds.includes(model.id) &&
          !accountForm.allowedCategories.includes(model.category),
      )
      .map((model) => model.displayName);
    return [...categoryPermissions, ...modelPermissions];
  }, [accountForm, visiblePermissionModels]);

  const loadUsageLogs = async (month = logMonth, accountId = logAccountId) => {
    if (!isSuperAdmin) {
      setUsageRecords([]);
      return;
    }
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams({ month });
      if (accountId) params.set("accountId", accountId);
      const usage = await adminFetch<{ records: UsageRecord[] }>(
        `usage-logs?${params.toString()}`,
      );
      setUsageRecords(usage.records);
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadAccounts = async () => {
    const result = await adminFetch<{ accounts: AdminAccount[] }>("accounts");
    setAccounts(result.accounts);
  };

  const loadProviderData = async () => {
    const [credentialResult, modelResult] = await Promise.all([
      adminFetch<{ credentials: AdminCredential[] }>("credentials"),
      adminFetch<{ models: AdminModel[] }>("models"),
    ]);
    setCredentials(credentialResult.credentials);
    setModels(modelResult.models);
  };

  const loadAdminData = async (initial = false) => {
    if (initial) setLoadingInitial(true);
    setMessage("");
    try {
      await loadAccounts();
      if (isSuperAdmin) {
        await loadProviderData();
        await loadUsageLogs();
      } else {
        setActiveTab("members");
        setCredentials([]);
        setModels([]);
        setUsageRecords([]);
      }
      await accountStore.fetchSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载管理后台失败");
    } finally {
      if (initial) setLoadingInitial(false);
    }
  };

  useEffect(() => {
    void accountStore.fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (accountStore.loaded && !accountStore.authenticated) {
      navigate(Path.Auth);
      return;
    }
    if (accountStore.authenticated && accountStore.isAdmin()) {
      void loadAdminData(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountStore.authenticated, accountStore.loaded]);

  useEffect(() => {
    if (!isSuperAdmin && activeTab !== "members") {
      setActiveTab("members");
    }
  }, [activeTab, isSuperAdmin]);

  const canManageAccount = (account: AdminAccount) => {
    if (account.id === accountStore.user?.userId) return false;
    if (accountStore.user?.role === "super_admin") {
      return account.role === "admin" || account.role === "employee";
    }
    return accountStore.user?.role === "admin" && account.role === "employee";
  };

  const roleOptions = () =>
    accountStore.user?.role === "super_admin"
      ? (["admin", "employee"] as AccountRole[])
      : (["employee"] as AccountRole[]);

  const closeTransientPanels = () => {
    setAccountForm(null);
    setResetAccount(null);
    setResetPassword("");
    setProviderForm(null);
    setAccountFormError("");
    setProviderFormError("");
    setResetPasswordError("");
    setMessage("");
  };

  const switchAdminTab = (tab: AdminTab) => {
    if (tab === activeTab) return;
    closeTransientPanels();
    setActiveTab(tab);
  };

  const prepareAccountPanel = () => {
    setResetAccount(null);
    setResetPassword("");
    setProviderForm(null);
    setResetPasswordError("");
    setProviderFormError("");
    setAccountFormError("");
    setMessage("");
  };

  const openNewAccount = () => {
    prepareAccountPanel();
    setAccountForm(emptyAccountForm());
  };

  const openEditAccount = (account: AdminAccount) => {
    prepareAccountPanel();
    const allowedCategories = account.allowedCategories ?? [];
    const allowedModelIds = (account.allowedModelIds ?? []).filter(
      (modelId) => {
        const model = models.find((item) => item.id === modelId);
        return !model || !allowedCategories.includes(model.category);
      },
    );
    setAccountForm({
      id: account.id,
      username: account.username,
      name: account.name,
      password: "",
      role: account.role,
      quotaUnlimited: account.quotaUnlimited,
      monthlyChatTurns: String(account.monthlyChatTurns ?? 500),
      monthlySearchTurns: String(account.monthlySearchTurns ?? 100),
      monthlyImageCount: String(account.monthlyImageCount ?? 50),
      monthlyVideoCount: String(account.monthlyVideoCount ?? 10),
      allowedModelIds,
      allowedCategories,
    });
  };

  const openResetAccount = (account: AdminAccount) => {
    setAccountForm(null);
    setProviderForm(null);
    setAccountFormError("");
    setProviderFormError("");
    setResetPasswordError("");
    setMessage("");
    setResetAccount(account);
    setResetPassword("");
  };

  const toggleCategoryPermission = (category: ModelCategory) => {
    if (!accountForm) return;
    const selected = accountForm.allowedCategories.includes(category);
    setAccountForm({
      ...accountForm,
      allowedCategories: toggleValue(accountForm.allowedCategories, category),
      allowedModelIds: selected
        ? accountForm.allowedModelIds
        : accountForm.allowedModelIds.filter(
            (modelId) =>
              models.find((model) => model.id === modelId)?.category !==
              category,
          ),
    });
  };

  const saveAccount = async () => {
    if (!accountForm || savingAccount) return;
    if (!accountForm.quotaUnlimited && accountForm.role === "employee") {
      const quotaFields = [
        ["聊天额度", accountForm.monthlyChatTurns],
        ["搜索额度", accountForm.monthlySearchTurns],
        ["生图额度", accountForm.monthlyImageCount],
        ["视频额度", accountForm.monthlyVideoCount],
      ] as const;
      const invalid = quotaFields.find(([, value]) => {
        const number = Number(value);
        return !Number.isInteger(number) || number < 0;
      });
      if (invalid) {
        setAccountFormError(`${invalid[0]}必须为非负整数`);
        return;
      }
    }
    setSavingAccount(true);
    setAccountFormError("");
    try {
      const path = accountForm.id
        ? `accounts/${encodeURIComponent(accountForm.id)}`
        : "accounts";
      await adminFetch(path, {
        method: accountForm.id ? "PUT" : "POST",
        body: JSON.stringify({
          username: accountForm.username,
          name: accountForm.name,
          password: accountForm.password || undefined,
          role: accountForm.role,
          quotaUnlimited:
            accountForm.role !== "employee" || accountForm.quotaUnlimited,
          monthlyChatTurns: accountForm.monthlyChatTurns,
          monthlySearchTurns: accountForm.monthlySearchTurns,
          monthlyImageCount: accountForm.monthlyImageCount,
          monthlyVideoCount: accountForm.monthlyVideoCount,
          allowedModelIds: accountForm.allowedModelIds,
          allowedCategories: accountForm.allowedCategories,
        }),
      });
      setAccountForm(null);
      showToast(accountForm.id ? "成员信息已保存" : "成员已创建");
      await loadAccounts();
    } catch (error) {
      setAccountFormError(
        error instanceof Error ? error.message : "保存成员失败",
      );
    } finally {
      setSavingAccount(false);
    }
  };

  const updateAccountStatus = async (
    account: AdminAccount,
    action: "enable" | "disable",
  ) => {
    setProcessingAccountId(account.id);
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}/${action}`, {
        method: "POST",
      });
      showToast(action === "enable" ? "账号已启用" : "账号已禁用");
      await loadAccounts();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新账号状态失败");
    } finally {
      setProcessingAccountId("");
    }
  };

  const deleteAccount = async (account: AdminAccount) => {
    if (!window.confirm(`确定删除成员“${account.name}”吗？`)) return;
    setProcessingAccountId(account.id);
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}`, {
        method: "DELETE",
      });
      showToast("成员已删除");
      await loadAccounts();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除成员失败");
    } finally {
      setProcessingAccountId("");
    }
  };

  const saveResetPassword = async () => {
    if (!resetAccount || processingAccountId === resetAccount.id) return;
    if (resetPassword.length < 8) {
      setResetPasswordError("密码至少需要 8 位");
      return;
    }
    setProcessingAccountId(resetAccount.id);
    setResetPasswordError("");
    try {
      await adminFetch(`accounts/${encodeURIComponent(resetAccount.id)}`, {
        method: "PUT",
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetAccount(null);
      setResetPassword("");
      showToast("密码已重置");
    } catch (error) {
      setResetPasswordError(
        error instanceof Error ? error.message : "重置密码失败",
      );
    } finally {
      setProcessingAccountId("");
    }
  };

  const providerCredentials = (provider: ModelProvider) =>
    credentials.filter((credential) => credential.provider === provider);

  const openProvider = (provider: ModelProvider, credential?: AdminCredential) => {
    setAccountForm(null);
    setResetAccount(null);
    setResetPassword("");
    setAccountFormError("");
    setResetPasswordError("");
    setMessage("");
    setProviderFormError("");
    setProviderForm({
      id: credential?.id,
      provider,
      apiKey: "",
      baseUrl: credential?.baseUrl ?? "",
      keyConfigured: credential?.keyConfigured ?? false,
      enabled: credential?.enabled ?? false,
      useCompatibleMode: credential?.useCompatibleMode ?? false,
      categoryScope: credential?.categoryScope ?? "all",
    });
  };

  const saveProvider = async () => {
    if (!providerForm || savingProvider) return;
    if (!providerForm.keyConfigured && !providerForm.apiKey.trim()) {
      setProviderFormError("请先填写 API Key");
      return;
    }
    const baseUrl = providerForm.baseUrl?.trim() ?? "";
    if (baseUrl && !/^https?:\/\/.+/.test(baseUrl)) {
      setProviderFormError("后端地址必须以 http:// 或 https:// 开头");
      return;
    }
    setSavingProvider(true);
    setProviderFormError("");
    try {
      await adminFetch(
        providerForm.id
          ? `credentials/${encodeURIComponent(providerForm.id)}`
          : "credentials",
        {
          method: providerForm.id ? "PUT" : "POST",
          body: JSON.stringify({
            provider: providerForm.provider,
            apiKey: providerForm.apiKey,
            baseUrl: providerForm.baseUrl,
            enabled: providerForm.enabled,
            useCompatibleMode: providerForm.useCompatibleMode,
            categoryScope: providerForm.categoryScope,
          }),
        },
      );
      await Promise.all([loadProviderData(), accountStore.fetchSession()]);
      setProviderForm(null);
      showToast("服务商配置已保存");
    } catch (error) {
      setProviderFormError(
        error instanceof Error ? error.message : "保存服务商失败",
      );
    } finally {
      setSavingProvider(false);
    }
  };

  const toggleModel = async (model: AdminModel) => {
    if (savingModelIds.includes(model.id)) return;
    setSavingModelIds((current) => [...current, model.id]);
    try {
      const result = await adminFetch<{ model: AdminModel }>(
        `models/${encodeURIComponent(model.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({ enabled: !model.enabled }),
        },
      );
      setModels((current) =>
        current.map((item) =>
          item.id === model.id
            ? {
                ...item,
                ...result.model,
                hasUsableCredential: item.hasUsableCredential,
              }
            : item,
        ),
      );
      await accountStore.fetchSession();
      showToast(model.enabled ? "模型已停用" : "模型已启用");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新模型失败");
    } finally {
      setSavingModelIds((current) =>
        current.filter((modelId) => modelId !== model.id),
      );
    }
  };

  const updateModelEndpoint = async (
    model: AdminModel,
    endpointType: string,
  ) => {
    if (savingModelIds.includes(model.id)) return;
    if (endpointType === model.endpointType) return;
    setSavingModelIds((current) => [...current, model.id]);
    try {
      const result = await adminFetch<{ model: AdminModel }>(
        `models/${encodeURIComponent(model.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({ endpointType }),
        },
      );
      setModels((current) =>
        current.map((item) =>
          item.id === model.id
            ? {
                ...item,
                ...result.model,
                hasUsableCredential: item.hasUsableCredential,
              }
            : item,
        ),
      );
      showToast("接口协议已更新");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "更新接口协议失败",
      );
    } finally {
      setSavingModelIds((current) =>
        current.filter((modelId) => modelId !== model.id),
      );
    }
  };

  const getModelStatus = (model: AdminModel) => {
    return model.enabled ? "已启用" : "已停用";
  };

  const getPermissionSummary = (account: AdminAccount) => {
    if (account.role === "admin" || account.role === "super_admin") {
      return {
        categories: "全部分类",
        models: "全部可用模型",
      };
    }

    const allowedCategories = account.allowedCategories ?? [];
    const allowedModelIds = account.allowedModelIds ?? [];
    const authorizedModels = visiblePermissionModels.filter(
      (model) =>
        allowedModelIds.includes(model.id) &&
        !allowedCategories.includes(model.category),
    );
    return {
      categories:
        allowedCategories.map(getCategoryDisplayName).join("、") || "无",
      models: `额外模型 ${authorizedModels.length} 个`,
    };
  };

  const getLogModelName = (record: UsageRecord) =>
    record.modelDisplayName ??
    models.find(
      (model) =>
        model.id === record.modelId ||
        (model.provider === record.provider && model.model === record.model),
    )?.displayName ??
    "未知模型";

  if (accountStore.loaded && !accountStore.isAdmin()) {
    return (
      <main className={styles.admin}>
        <section className={styles["login-panel"]}>
          <h1>需要管理员权限</h1>
          <IconButton text="返回聊天" onClick={() => navigate(Path.Chat)} />
        </section>
      </main>
    );
  }

  return (
    <main className={styles.admin}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img src="/newbiechat-logo.svg" alt="" />
          <h1>NewbieChat 管理后台</h1>
        </div>
        <IconButton
          text="返回聊天"
          bordered
          onClick={() => navigate(Path.Chat)}
        />
      </header>

      <nav className={styles.tabs} aria-label="管理后台栏目">
        {(isSuperAdmin ? TABS : TABS.slice(0, 1)).map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? styles.active : ""}
            disabled={savingAccount || savingProvider}
            onClick={() => switchAdminTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {message && <div className={styles.message}>{message}</div>}
      {loadingInitial && accounts.length === 0 && (
        <div className={styles.message}>正在加载管理数据…</div>
      )}

      {activeTab === "members" && (
        <section className={styles.panel}>
          <div className={styles["panel-title"]}>
            <h2>成员账号</h2>
            <IconButton
              text="新增成员"
              type="primary"
              disabled={loadingInitial || savingAccount}
              onClick={openNewAccount}
            />
          </div>
          <div className={styles["table-wrap"]}>
            <table className={styles["members-table"]}>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色与状态</th>
                  <th>额度</th>
                  <th>权限</th>
                  <th>最后登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.name}</strong>
                      <span className={styles.subtle}>{account.username}</span>
                    </td>
                    <td>
                      <span>{getRoleDisplayName(account.role)}</span>
                      <span className={styles.subtle}>
                        {getAccountStatusDisplayName(account.status)}
                      </span>
                    </td>
                    <td>
                      {account.role !== "employee" || account.quotaUnlimited ? (
                        <span>不限额度</span>
                      ) : (
                        <div className={styles["quota-summary"]}>
                          <span>
                            聊天：{account.usedChatTurns} /{" "}
                            {account.monthlyChatTurns ?? 0}
                          </span>
                          <span>
                            搜索：{account.usedSearchTurns} /{" "}
                            {account.monthlySearchTurns ?? 0}
                          </span>
                          <span>
                            生图：{account.usedImageCount} /{" "}
                            {account.monthlyImageCount ?? 0}
                          </span>
                          <span>
                            视频：{account.usedVideoCount} /{" "}
                            {account.monthlyVideoCount ?? 0}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span>{getPermissionSummary(account).categories}</span>
                      <span className={styles.subtle}>
                        {getPermissionSummary(account).models}
                      </span>
                    </td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>
                      {canManageAccount(account) ? (
                        <div className={styles["row-actions"]}>
                          <button
                            type="button"
                            disabled={processingAccountId === account.id}
                            onClick={() => openEditAccount(account)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            disabled={processingAccountId === account.id}
                            onClick={() => {
                              openResetAccount(account);
                            }}
                          >
                            重置密码
                          </button>
                          <button
                            type="button"
                            disabled={processingAccountId === account.id}
                            onClick={() =>
                              void updateAccountStatus(
                                account,
                                account.status === "disabled"
                                  ? "enable"
                                  : "disable",
                              )
                            }
                          >
                            {processingAccountId === account.id
                              ? "处理中…"
                              : account.status === "disabled"
                              ? "启用"
                              : "禁用"}
                          </button>
                          <button
                            type="button"
                            disabled={processingAccountId === account.id}
                            onClick={() => void deleteAccount(account)}
                          >
                            删除
                          </button>
                        </div>
                      ) : (
                        <span className={styles.subtle}>不可操作</span>
                      )}
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && !loadingInitial && (
                  <tr>
                    <td colSpan={6}>暂无成员</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isSuperAdmin && activeTab === "providers" && (
        <section className={styles.panel}>
          <h2>服务商</h2>
          <div className={styles["provider-grid"]}>
            {PROVIDERS.map((provider) => {
              const creds = providerCredentials(provider);
              const hasEnabled = creds.some((c) => c.enabled && c.keyConfigured);
              const providerStatus =
                creds.length === 0
                  ? "未配置"
                  : hasEnabled
                  ? "已启用"
                  : "已停用";
              return (
                <article className={styles.provider} key={provider}>
                  <div className={styles["provider-header"]}>
                    <strong>{PROVIDER_NAMES[provider]}</strong>
                    <span>{providerStatus}</span>
                  </div>
                  {creds.length === 0 ? (
                    <div className={styles.subtle}>暂无凭据，请添加</div>
                  ) : (
                    creds.map((cred) => (
                      <div
                        key={cred.id}
                        className={styles["provider-credential"]}
                        style={{
                          padding: "8px 0",
                          borderTop: "1px solid var(--color-in-border)",
                        }}
                      >
                        <div>
                          适用类别：{getCategoryScopeLabel(cred.categoryScope)}
                          {" | "}
                          密钥：{cred.keyConfigured ? "已配置" : "未配置"}
                          {" | "}
                          状态：{cred.enabled ? "已启用" : "已停用"}
                        </div>
                        {cred.baseUrl?.trim() && (
                          <div
                            className={styles["provider-baseurl"]}
                            title={cred.baseUrl}
                          >
                            中转地址：{cred.baseUrl}
                          </div>
                        )}
                        <div>
                          兼容模式：{cred.useCompatibleMode ? "已开启" : "已关闭"}
                        </div>
                        <IconButton
                          text="编辑"
                          disabled={savingProvider}
                          onClick={() => openProvider(provider, cred)}
                        />
                      </div>
                    ))
                  )}
                  <IconButton
                    text="添加凭据"
                    disabled={savingProvider}
                    onClick={() => openProvider(provider)}
                  />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {isSuperAdmin && activeTab === "models" && (
        <section className={styles.panel}>
          <h2>模型</h2>
          {models.length === 0 ? (
            <div className={styles["empty-state"]}>
              请先在“服务商”中配置并启用服务商。
            </div>
          ) : (
            modelsByCategory.map((group) =>
              group.models.length === 0 ? null : (
                <div className={styles["model-group"]} key={group.category}>
                  <h3>{getCategoryDisplayName(group.category)}</h3>
                  <div className={styles["table-wrap"]}>
                    <table className={styles["models-table"]}>
                      <thead>
                        <tr>
                          <th>模型名称</th>
                          <th>Provider</th>
                          <th>分类</th>
                          <th>接口协议</th>
                          <th>状态</th>
                          <th>启用开关</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.models.map((model) => (
                          <tr key={model.id}>
                            <td>{model.displayName}</td>
                            <td>{PROVIDER_NAMES[model.provider]}</td>
                            <td>{getCategoryDisplayName(model.category)}</td>
                            <td>
                              <select
                                value={model.endpointType}
                                disabled={savingModelIds.includes(model.id)}
                                onChange={(e) =>
                                  void updateModelEndpoint(
                                    model,
                                    e.currentTarget.value,
                                  )
                                }
                              >
                                <option value="openai_responses">
                                  OpenAI Responses
                                </option>
                                <option value="openai_compatible_chat">
                                  OpenAI 兼容（中转商）
                                </option>
                                <option value="anthropic_messages">
                                  Anthropic Messages
                                </option>
                                <option value="google_generate_content">
                                  Google GenerateContent
                                </option>
                                <option value="google_interactions">
                                  Google Interactions
                                </option>
                                <option value="perplexity_sonar">
                                  Perplexity Sonar
                                </option>
                                <option value="openai_images">
                                  OpenAI 图片生成
                                </option>
                                <option value="google_image">
                                  Google 图片生成
                                </option>
                                <option value="xai_images">
                                  xAI 图片生成
                                </option>
                                <option value="not_implemented">
                                  未实现
                                </option>
                              </select>
                            </td>
                            <td>{getModelStatus(model)}</td>
                            <td>
                              <button
                                type="button"
                                className={styles["model-toggle"]}
                                disabled={savingModelIds.includes(model.id)}
                                onClick={() => void toggleModel(model)}
                              >
                                {savingModelIds.includes(model.id)
                                  ? "保存中…"
                                  : model.enabled
                                  ? "停用"
                                  : "启用"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            )
          )}
        </section>
      )}

      {isSuperAdmin && activeTab === "logs" && (
        <section className={styles.panel}>
          <div className={styles["panel-title"]}>
            <h2>使用日志</h2>
            <div className={styles.filters}>
              <input
                aria-label="月份"
                type="month"
                value={logMonth}
                onChange={(event) => setLogMonth(event.currentTarget.value)}
              />
              <select
                aria-label="账号"
                value={logAccountId}
                onChange={(event) => setLogAccountId(event.currentTarget.value)}
              >
                <option value="">全部账号</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.username}
                  </option>
                ))}
              </select>
              <IconButton
                text={loadingLogs ? "查询中…" : "查询"}
                disabled={loadingLogs}
                onClick={() =>
                  void loadUsageLogs().catch((error) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "查询使用日志失败",
                    ),
                  )
                }
              />
            </div>
          </div>
          <div className={styles["table-wrap"]}>
            <table className={styles["logs-table"]}>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>账号与角色</th>
                  <th>服务商与模型</th>
                  <th>分类与状态</th>
                  <th>成员输入</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {usageRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.createdAt)}</td>
                    <td>
                      <span>{record.username}</span>
                      <span className={styles.subtle}>
                        {getRoleDisplayName(record.role)}
                      </span>
                    </td>
                    <td>
                      <span>
                        {PROVIDER_NAMES[record.provider as ModelProvider] ??
                          "未知服务商"}
                      </span>
                      <span className={styles.subtle}>
                        {getLogModelName(record)}
                      </span>
                    </td>
                    <td>
                      <span>{getCategoryDisplayName(record.category)}</span>
                      <span className={styles.subtle}>
                        {getLogStatus(record.status)}
                      </span>
                    </td>
                    <td className={styles.preview}>
                      {record.promptContent || record.promptPreview || "-"}
                    </td>
                    <td className={styles.preview}>
                      {record.errorMessage || "-"}
                    </td>
                  </tr>
                ))}
                {usageRecords.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      {loadingLogs ? "正在查询日志…" : "暂无日志"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "members" && accountForm && (
        <Modal
          title={accountForm.id ? "编辑成员" : "新增成员"}
          onClose={() => {
            setAccountForm(null);
            setAccountFormError("");
          }}
          actions={[
            <IconButton
              key="cancel"
              text="取消"
              onClick={() => {
                setAccountForm(null);
                setAccountFormError("");
              }}
            />,
            <IconButton
              key="save"
              type="primary"
              text={savingAccount ? "保存中…" : "保存"}
              disabled={savingAccount}
              onClick={() => void saveAccount()}
            />,
          ]}
        >
          <div className={styles["modal-form"]}>
            <label>
              登录账号
              <input
                type="text"
                autoComplete="off"
                value={accountForm.username}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    username: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label>
              成员名称
              <input
                type="text"
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    name: event.currentTarget.value,
                  })
                }
              />
            </label>
            {!accountForm.id && (
              <label>
                密码
                <input
                  type="password"
                  autoComplete="new-password"
                  value={accountForm.password}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      password: event.currentTarget.value,
                    })
                  }
                />
              </label>
            )}
            <label>
              角色
              <select
                value={accountForm.role}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    role: event.currentTarget.value as AccountRole,
                  })
                }
              >
                {roleOptions().map((role) => (
                  <option key={role} value={role}>
                    {getRoleDisplayName(role)}
                  </option>
                ))}
              </select>
            </label>
            {accountForm.role === "employee" ? (
              <>
                <div className={styles["switch-row"]}>
                  <span>不限额度</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={accountForm.quotaUnlimited}
                    aria-label="不限额度"
                    className={styles.switch}
                    onClick={() =>
                      setAccountForm({
                        ...accountForm,
                        quotaUnlimited: !accountForm.quotaUnlimited,
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
                {accountForm.quotaUnlimited ? (
                  <div className={styles["permission-summary"]}>不限额度</div>
                ) : (
                  <div className={styles["quota-fields"]}>
                    {QUOTA_FORM_FIELDS.map(({ label, field, unit }) => (
                      <label key={field}>
                        {label}
                        <span className={styles["quota-input"]}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={accountForm[field]}
                            onChange={(event) =>
                              setAccountForm({
                                ...accountForm,
                                [field]: event.currentTarget.value,
                              })
                            }
                          />
                          <span>{unit}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <fieldset className={styles["permission-fieldset"]}>
                  <legend>开放分类</legend>
                  <p className={styles["permission-help"]}>
                    勾选后，该成员可以使用此分类下全部当前可用模型。
                  </p>
                  <div className={styles["permission-options"]}>
                    {CATEGORIES.map((category) => (
                      <label
                        key={category}
                        className={
                          accountForm.allowedCategories.includes(category)
                            ? styles.selected
                            : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={accountForm.allowedCategories.includes(
                            category,
                          )}
                          onChange={() => toggleCategoryPermission(category)}
                        />
                        <span>{getCategoryDisplayName(category)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className={styles["permission-fieldset"]}>
                  <legend>额外开放模型</legend>
                  <p className={styles["permission-help"]}>
                    用于单独开放未勾选分类中的模型。
                  </p>
                  <div className={styles["permission-options"]}>
                    {extraPermissionModels.map((model) => (
                      <label
                        key={model.id}
                        className={
                          accountForm.allowedModelIds.includes(model.id)
                            ? styles.selected
                            : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={accountForm.allowedModelIds.includes(
                            model.id,
                          )}
                          onChange={() =>
                            setAccountForm({
                              ...accountForm,
                              allowedModelIds: toggleValue(
                                accountForm.allowedModelIds,
                                model.id,
                              ),
                            })
                          }
                        />
                        <span>
                          <strong>{model.displayName}</strong>
                          <small>{PROVIDER_NAMES[model.provider]}</small>
                        </span>
                      </label>
                    ))}
                    {visiblePermissionModels.length === 0 ? (
                      <span className={styles["permission-empty"]}>
                        暂无可授权模型，请先配置并启用服务商和模型。
                      </span>
                    ) : extraPermissionModels.length === 0 ? (
                      <span className={styles["permission-empty"]}>
                        已开放分类包含全部可用模型，无需额外选择。
                      </span>
                    ) : null}
                  </div>
                </fieldset>
                <div className={styles["permission-summary"]}>
                  <strong>当前成员最终权限</strong>
                  <span>
                    {currentPermissionSummary.length
                      ? currentPermissionSummary.join("、")
                      : "未开放任何模型"}
                  </span>
                </div>
                {currentPermissionSummary.length === 0 && (
                  <div className={styles["permission-warning"]}>
                    该成员保存后将没有可用模型。
                  </div>
                )}
              </>
            ) : (
              <div className={styles["permission-summary"]}>
                <strong>全部分类</strong>
                <span>全部可用模型</span>
              </div>
            )}
            {accountFormError && (
              <div className={styles["form-error"]}>{accountFormError}</div>
            )}
          </div>
        </Modal>
      )}

      {activeTab === "members" && resetAccount && (
        <Modal
          title={`重置 ${resetAccount.username} 的密码`}
          onClose={() => {
            setResetAccount(null);
            setResetPasswordError("");
          }}
          actions={[
            <IconButton
              key="cancel"
              text="取消"
              onClick={() => {
                setResetAccount(null);
                setResetPasswordError("");
              }}
            />,
            <IconButton
              key="save"
              type="primary"
              text={
                processingAccountId === resetAccount.id ? "保存中…" : "保存"
              }
              disabled={processingAccountId === resetAccount.id}
              onClick={() => void saveResetPassword()}
            />,
          ]}
        >
          <div className={styles["modal-form"]}>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(event) =>
                  setResetPassword(event.currentTarget.value)
                }
              />
            </label>
            {resetPasswordError && (
              <div className={styles["form-error"]}>{resetPasswordError}</div>
            )}
          </div>
        </Modal>
      )}

      {activeTab === "providers" && providerForm && (
        <Modal
          title={`配置 ${PROVIDER_NAMES[providerForm.provider]} - ${getCategoryScopeLabel(providerForm.categoryScope)}`}
          onClose={() => {
            setProviderForm(null);
            setProviderFormError("");
          }}
          actions={[
            <IconButton
              key="cancel"
              text="取消"
              onClick={() => {
                setProviderForm(null);
                setProviderFormError("");
              }}
            />,
            <IconButton
              key="save"
              type="primary"
              text={savingProvider ? "保存中…" : "保存"}
              disabled={
                savingProvider ||
                (!providerForm.keyConfigured && !providerForm.apiKey.trim())
              }
              onClick={() => void saveProvider()}
            />,
          ]}
        >
          <div className={`${styles["modal-form"]} ${styles["provider-form"]}`}>
            <label>
              <span>适用类别</span>
              <small>选择此凭据适用的功能类别。可为对话和图片分别配置不同密钥</small>
              <select
                value={providerForm.categoryScope}
                disabled={!!providerForm.id}
                onChange={(e) =>
                  setProviderForm({
                    ...providerForm,
                    categoryScope: e.currentTarget
                      .value as ModelCategory | "all",
                  })
                }
              >
                {CATEGORY_SCOPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>API Key</span>
              <small>服务商提供的访问密钥，修改时留空表示保留原密钥</small>
              <input
                type="password"
                autoComplete="new-password"
                value={providerForm.apiKey}
                placeholder={
                  providerForm.id ? "留空则保留原 API Key" : "请输入 API Key"
                }
                onChange={(event) =>
                  setProviderForm({
                    ...providerForm,
                    apiKey: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label>
              <span>后端地址（可选）</span>
              <small>
                用于接入中转商，例如 https://hosaia.com/v1。不填则使用官方默认地址
              </small>
              <input
                type="text"
                autoComplete="off"
                value={providerForm.baseUrl ?? ""}
                placeholder="https://hosaia.com/v1"
                onChange={(event) =>
                  setProviderForm({
                    ...providerForm,
                    baseUrl: event.currentTarget.value,
                  })
                }
              />
            </label>
            <div className={styles["switch-row"]}>
              <span>兼容模式</span>
              <button
                type="button"
                role="switch"
                aria-checked={providerForm.useCompatibleMode}
                aria-label={`${providerForm.useCompatibleMode ? "关闭" : "开启"}兼容模式`}
                className={styles.switch}
                onClick={() =>
                  setProviderForm({
                    ...providerForm,
                    useCompatibleMode: !providerForm.useCompatibleMode,
                  })
                }
              >
                <span />
              </button>
            </div>
            <p className={styles["permission-help"]}>
              开启后，该服务商的聊天模型会走标准 OpenAI 兼容接口
              /v1/chat/completions，适合 sub2api、openrouter、hosaia 等中转商。关闭则走该服务商专用协议。
            </p>
            <div className={styles["switch-row"]}>
              <span>启用状态</span>
              <button
                type="button"
                role="switch"
                aria-checked={providerForm.enabled}
                aria-label={`${providerForm.enabled ? "停用" : "启用"} ${
                  PROVIDER_NAMES[providerForm.provider]
                }`}
                className={styles.switch}
                onClick={() =>
                  setProviderForm({
                    ...providerForm,
                    enabled: !providerForm.enabled,
                  })
                }
              >
                <span />
              </button>
            </div>
            {providerFormError && (
              <div className={styles["form-error"]}>{providerFormError}</div>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
