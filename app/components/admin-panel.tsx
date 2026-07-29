"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ModelCategory, ModelProvider } from "../config/model-registry";
import { Path } from "../constant";
import { useAccountStore } from "../store";
import { IconButton } from "./button";
import { showToast } from "./ui-lib";
import styles from "./admin.module.scss";

type AccountRole = "employee" | "admin" | "super_admin";

interface AdminAccount {
  id: string;
  username: string;
  name: string;
  role: AccountRole;
  status: string;
  monthlyQuota?: number | string;
  usedQuota?: number | string;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  password?: string;
}

interface AdminCredential {
  id: string;
  provider: ModelProvider;
  name: string;
  keyConfigured: boolean;
  keyPreview: string;
  baseUrl?: string;
  apiVersion?: string;
  orgId?: string;
  categoryScope: ModelCategory | "all";
  modelIds?: string[];
  enabled: boolean;
  verified: boolean;
  priority: number;
  updatedAt?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

interface AdminModel {
  id: string;
  provider: ModelProvider;
  category: ModelCategory;
  displayName: string;
  model: string;
  endpointType: string;
  enabled: boolean;
  verified: boolean;
  adminOnly?: boolean;
  legacy?: boolean;
  deprecated?: boolean;
  sort: number;
  hasUsableCredential: boolean;
}

interface UsageSummary {
  accountId: string;
  username: string;
  name?: string;
  role: string;
  monthlyQuota?: number;
  usedQuota: number;
  remainingQuota?: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  blockedCount: number;
  inputTokens: number;
}

interface UsageRecord {
  id: string;
  accountId: string;
  username: string;
  role: string;
  provider: string;
  modelId: string;
  model: string;
  category: ModelCategory;
  promptPreview: string;
  promptContent?: string;
  status: string;
  httpStatus?: number;
  errorMessage?: string;
  createdAt: string;
}

const PROVIDERS: ModelProvider[] = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
];
const CATEGORIES: Array<ModelCategory | "all"> = [
  "all",
  "chat",
  "image",
  "search",
  "video",
];

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
    throw new Error(body.message ?? "Admin request failed");
  }
  return body as T;
}

function csv(value?: string[]) {
  return value?.join(",") ?? "";
}

function parseCsv(value?: string[] | string) {
  if (Array.isArray(value)) return value;
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function quotaValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function roleOptions(currentRole?: AccountRole) {
  if (currentRole === "super_admin") {
    return ["super_admin", "admin", "employee"] as AccountRole[];
  }
  return ["employee"] as AccountRole[];
}

export function AdminPanel() {
  const navigate = useNavigate();
  const accountStore = useAccountStore();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [credentials, setCredentials] = useState<AdminCredential[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [usageSummaries, setUsageSummaries] = useState<UsageSummary[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [accountForm, setAccountForm] = useState({
    username: "",
    name: "",
    password: "",
    role: "employee" as AccountRole,
    monthlyQuota: "100000",
    allowedModelIds: "",
    allowedCategories: "chat,search",
  });
  const [credentialForm, setCredentialForm] = useState({
    provider: "openai" as ModelProvider,
    name: "",
    apiKey: "",
    categoryScope: "all" as ModelCategory | "all",
    modelIds: "",
    baseUrl: "",
    apiVersion: "",
    orgId: "",
    priority: "100",
  });

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status !== "disabled").length,
    [accounts],
  );
  const usableModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.verified &&
          model.hasUsableCredential &&
          model.endpointType !== "not_implemented",
      ).length,
    [models],
  );

  const loadDashboard = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [accountRes, credentialRes, modelRes, usageRes] = await Promise.all(
        [
          adminFetch<{ accounts: AdminAccount[] }>("accounts"),
          adminFetch<{ credentials: AdminCredential[] }>("credentials"),
          adminFetch<{ models: AdminModel[] }>("models"),
          adminFetch<{
            summaries: UsageSummary[];
            records: UsageRecord[];
          }>("usage-logs"),
        ],
      );
      setAccounts(accountRes.accounts);
      setCredentials(credentialRes.credentials);
      setModels(modelRes.models);
      setUsageSummaries(usageRes.summaries);
      setUsageRecords(usageRes.records);
      await accountStore.fetchSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void accountStore.fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (accountStore.loaded && !accountStore.authenticated) {
      navigate(Path.Auth);
    }
    if (accountStore.authenticated && accountStore.isAdmin()) {
      void loadDashboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountStore.authenticated, accountStore.loaded]);

  const createAccount = async () => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch("accounts", {
        method: "POST",
        body: JSON.stringify({
          ...accountForm,
          monthlyQuota: accountForm.monthlyQuota || undefined,
          allowedModelIds: parseCsv(accountForm.allowedModelIds),
          allowedCategories: parseCsv(accountForm.allowedCategories),
        }),
      });
      setAccountForm({
        username: "",
        name: "",
        password: "",
        role: "employee",
        monthlyQuota: "100000",
        allowedModelIds: "",
        allowedCategories: "chat,search",
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const saveAccount = async (account: AdminAccount) => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...account,
          password: account.password || undefined,
          monthlyQuota: account.monthlyQuota || undefined,
          allowedModelIds: parseCsv(account.allowedModelIds),
          allowedCategories: parseCsv(account.allowedCategories),
        }),
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const disableAccount = async (account: AdminAccount) => {
    setLoading(true);
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}/disable`, {
        method: "POST",
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async (account: AdminAccount) => {
    setLoading(true);
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}`, {
        method: "DELETE",
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const createCredential = async () => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch("credentials", {
        method: "POST",
        body: JSON.stringify({
          ...credentialForm,
          priority: credentialForm.priority || 100,
          modelIds: parseCsv(credentialForm.modelIds),
        }),
      });
      setCredentialForm({
        provider: "openai",
        name: "",
        apiKey: "",
        categoryScope: "all",
        modelIds: "",
        baseUrl: "",
        apiVersion: "",
        orgId: "",
        priority: "100",
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const saveCredential = async (credential: AdminCredential) => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch(`credentials/${encodeURIComponent(credential.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...credential,
          apiKey: credential.apiKey || undefined,
          modelIds: parseCsv(credential.modelIds),
        }),
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const testCredential = async (credential: AdminCredential) => {
    setLoading(true);
    try {
      const result = await adminFetch<{ ok: boolean; message: string }>(
        `credentials/${encodeURIComponent(credential.id)}/test`,
        { method: "POST" },
      );
      showToast(result.message);
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteCredential = async (credential: AdminCredential) => {
    setLoading(true);
    try {
      await adminFetch(`credentials/${encodeURIComponent(credential.id)}`, {
        method: "DELETE",
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const saveModel = async (model: AdminModel) => {
    setLoading(true);
    try {
      await adminFetch(`models/${encodeURIComponent(model.id)}`, {
        method: "PUT",
        body: JSON.stringify(model),
      });
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const verifyModel = async (model: AdminModel) => {
    setLoading(true);
    try {
      const result = await adminFetch<{ ok: boolean; message: string }>(
        `models/${encodeURIComponent(model.id)}/verify`,
        { method: "POST" },
      );
      showToast(result.message);
      await loadDashboard();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const updateAccount = (index: number, patch: Partial<AdminAccount>) => {
    setAccounts((current) =>
      current.map((account, itemIndex) =>
        itemIndex === index ? { ...account, ...patch } : account,
      ),
    );
  };

  const updateCredential = (index: number, patch: Partial<AdminCredential>) => {
    setCredentials((current) =>
      current.map((credential, itemIndex) =>
        itemIndex === index ? { ...credential, ...patch } : credential,
      ),
    );
  };

  const updateModel = (index: number, patch: Partial<AdminModel>) => {
    setModels((current) =>
      current.map((model, itemIndex) =>
        itemIndex === index ? { ...model, ...patch } : model,
      ),
    );
  };

  if (accountStore.loaded && !accountStore.isAdmin()) {
    return (
      <main className={styles.admin}>
        <section className={styles["login-panel"]}>
          <h1>NewbieChat Admin</h1>
          <p>Admin role required.</p>
          <IconButton text="Back to chat" onClick={() => navigate(Path.Chat)} />
        </section>
      </main>
    );
  }

  return (
    <main className={styles.admin}>
      <header className={styles.header}>
        <div>
          <h1>NewbieChat Admin</h1>
          <div className={styles.subtle}>
            Team accounts, model access, Provider credentials and prompt logs
          </div>
        </div>
        <div className={styles["header-actions"]}>
          <IconButton
            text="Refresh"
            bordered
            disabled={loading}
            onClick={loadDashboard}
          />
          <IconButton
            text="Settings"
            bordered
            onClick={() => navigate(Path.Settings)}
          />
          <IconButton
            text="Chat"
            bordered
            onClick={() => navigate(Path.Chat)}
          />
        </div>
      </header>

      {message && <div className={styles.message}>{message}</div>}

      <section className={styles.metrics}>
        <div>
          <strong>{accounts.length}</strong>
          <span>Total accounts</span>
        </div>
        <div>
          <strong>{activeAccounts}</strong>
          <span>Active accounts</span>
        </div>
        <div>
          <strong>{credentials.filter((item) => item.verified).length}</strong>
          <span>Verified credentials</span>
        </div>
        <div>
          <strong>{usableModels}</strong>
          <span>Employee-visible models</span>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Accounts</h2>
        <div className={styles["form-grid"]}>
          <input
            value={accountForm.username}
            placeholder="Username"
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                username: event.currentTarget.value,
              })
            }
          />
          <input
            value={accountForm.name}
            placeholder="Name"
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                name: event.currentTarget.value,
              })
            }
          />
          <input
            value={accountForm.password}
            type="password"
            placeholder="Password"
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                password: event.currentTarget.value,
              })
            }
          />
          <select
            value={accountForm.role}
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                role: event.currentTarget.value as AccountRole,
              })
            }
          >
            {roleOptions(accountStore.user?.role).map((role) => (
              <option value={role} key={role}>
                {role}
              </option>
            ))}
          </select>
          <input
            value={accountForm.monthlyQuota}
            placeholder="Monthly quota"
            type="number"
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                monthlyQuota: event.currentTarget.value,
              })
            }
          />
          <input
            value={accountForm.allowedCategories}
            placeholder="Allowed categories"
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                allowedCategories: event.currentTarget.value,
              })
            }
          />
          <input
            value={accountForm.allowedModelIds}
            placeholder="Allowed model IDs"
            onChange={(event) =>
              setAccountForm({
                ...accountForm,
                allowedModelIds: event.currentTarget.value,
              })
            }
          />
          <IconButton
            text="Create account"
            type="primary"
            disabled={loading}
            onClick={createAccount}
          />
        </div>

        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Quota</th>
                <th>Categories</th>
                <th>Model IDs</th>
                <th>Reset password</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account, index) => (
                <tr key={account.id}>
                  <td>{account.username}</td>
                  <td>
                    <input
                      value={account.name}
                      onChange={(event) =>
                        updateAccount(index, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={account.role}
                      onChange={(event) =>
                        updateAccount(index, {
                          role: event.currentTarget.value as AccountRole,
                        })
                      }
                    >
                      {roleOptions(accountStore.user?.role).map((role) => (
                        <option value={role} key={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={account.status}
                      onChange={(event) =>
                        updateAccount(index, {
                          status: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={quotaValue(account.monthlyQuota)}
                      type="number"
                      onChange={(event) =>
                        updateAccount(index, {
                          monthlyQuota: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={csv(account.allowedCategories)}
                      onChange={(event) =>
                        updateAccount(index, {
                          allowedCategories: parseCsv(
                            event.currentTarget.value,
                          ) as ModelCategory[],
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={csv(account.allowedModelIds)}
                      onChange={(event) =>
                        updateAccount(index, {
                          allowedModelIds: parseCsv(event.currentTarget.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="password"
                      value={account.password ?? ""}
                      placeholder="New password"
                      onChange={(event) =>
                        updateAccount(index, {
                          password: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td className={styles["row-actions"]}>
                    <button
                      disabled={loading}
                      onClick={() => saveAccount(account)}
                    >
                      Save
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => disableAccount(account)}
                    >
                      Disable
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => deleteAccount(account)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Provider Credentials</h2>
        <div className={styles["form-grid"]}>
          <select
            value={credentialForm.provider}
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                provider: event.currentTarget.value as ModelProvider,
              })
            }
          >
            {PROVIDERS.map((provider) => (
              <option value={provider} key={provider}>
                {provider}
              </option>
            ))}
          </select>
          <input
            value={credentialForm.name}
            placeholder="Credential name"
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                name: event.currentTarget.value,
              })
            }
          />
          <input
            value={credentialForm.apiKey}
            type="password"
            placeholder="Provider API Key"
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                apiKey: event.currentTarget.value,
              })
            }
          />
          <select
            value={credentialForm.categoryScope}
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                categoryScope: event.currentTarget.value as
                  | ModelCategory
                  | "all",
              })
            }
          >
            {CATEGORIES.map((category) => (
              <option value={category} key={category}>
                {category}
              </option>
            ))}
          </select>
          <input
            value={credentialForm.modelIds}
            placeholder="Scoped model IDs"
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                modelIds: event.currentTarget.value,
              })
            }
          />
          <input
            value={credentialForm.priority}
            type="number"
            placeholder="Priority"
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                priority: event.currentTarget.value,
              })
            }
          />
          <input
            value={credentialForm.baseUrl}
            placeholder="Base URL"
            onChange={(event) =>
              setCredentialForm({
                ...credentialForm,
                baseUrl: event.currentTarget.value,
              })
            }
          />
          <IconButton
            text="Add credential"
            type="primary"
            disabled={loading}
            onClick={createCredential}
          />
        </div>

        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Key</th>
                <th>Scope</th>
                <th>Model IDs</th>
                <th>Priority</th>
                <th>Enabled</th>
                <th>Verified</th>
                <th>New key</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((credential, index) => (
                <tr key={credential.id}>
                  <td>
                    <input
                      value={credential.name}
                      onChange={(event) =>
                        updateCredential(index, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>{credential.provider}</td>
                  <td>
                    {credential.keyConfigured
                      ? credential.keyPreview
                      : "not set"}
                  </td>
                  <td>
                    <select
                      value={credential.categoryScope}
                      onChange={(event) =>
                        updateCredential(index, {
                          categoryScope: event.currentTarget.value as
                            | ModelCategory
                            | "all",
                        })
                      }
                    >
                      {CATEGORIES.map((category) => (
                        <option value={category} key={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={csv(credential.modelIds)}
                      onChange={(event) =>
                        updateCredential(index, {
                          modelIds: parseCsv(event.currentTarget.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={credential.priority}
                      type="number"
                      onChange={(event) =>
                        updateCredential(index, {
                          priority: event.currentTarget.valueAsNumber,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={credential.enabled}
                      onChange={(event) =>
                        updateCredential(index, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />
                  </td>
                  <td>{credential.verified ? "yes" : "no"}</td>
                  <td>
                    <input
                      type="password"
                      value={credential.apiKey ?? ""}
                      placeholder="Replace key"
                      onChange={(event) =>
                        updateCredential(index, {
                          apiKey: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td className={styles["row-actions"]}>
                    <button
                      disabled={loading}
                      onClick={() => saveCredential(credential)}
                    >
                      Save
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => testCredential(credential)}
                    >
                      Test
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => deleteCredential(credential)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Model Catalog</h2>
        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Display</th>
                <th>Provider</th>
                <th>Category</th>
                <th>API model</th>
                <th>Endpoint</th>
                <th>Enabled</th>
                <th>Verified</th>
                <th>Credential</th>
                <th>Admin only</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model, index) => (
                <tr key={model.id}>
                  <td>{model.id}</td>
                  <td>
                    <input
                      value={model.displayName}
                      onChange={(event) =>
                        updateModel(index, {
                          displayName: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>{model.provider}</td>
                  <td>{model.category}</td>
                  <td>
                    <input
                      value={model.model}
                      onChange={(event) =>
                        updateModel(index, { model: event.currentTarget.value })
                      }
                    />
                  </td>
                  <td>{model.endpointType}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={(event) =>
                        updateModel(index, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />
                  </td>
                  <td>{model.verified ? "yes" : "no"}</td>
                  <td>{model.hasUsableCredential ? "yes" : "no"}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!model.adminOnly}
                      onChange={(event) =>
                        updateModel(index, {
                          adminOnly: event.currentTarget.checked,
                        })
                      }
                    />
                  </td>
                  <td className={styles["row-actions"]}>
                    <button disabled={loading} onClick={() => saveModel(model)}>
                      Save
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => verifyModel(model)}
                    >
                      Verify
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Usage Logs</h2>
        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Quota</th>
                <th>Used</th>
                <th>Remaining</th>
                <th>Requests</th>
                <th>Success</th>
                <th>Failed</th>
                <th>Blocked</th>
                <th>Input tokens</th>
              </tr>
            </thead>
            <tbody>
              {usageSummaries.map((summary) => (
                <tr key={summary.accountId}>
                  <td>{summary.name || summary.username}</td>
                  <td>{summary.monthlyQuota ?? "unlimited"}</td>
                  <td>{summary.usedQuota}</td>
                  <td>{summary.remainingQuota ?? ""}</td>
                  <td>{summary.requestCount}</td>
                  <td>{summary.successCount}</td>
                  <td>{summary.failedCount}</td>
                  <td>{summary.blockedCount}</td>
                  <td>{summary.inputTokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Account</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Category</th>
                <th>Status</th>
                <th>Prompt</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {usageRecords.map((record) => (
                <tr key={record.id}>
                  <td>{new Date(record.createdAt).toLocaleString()}</td>
                  <td>{record.username}</td>
                  <td>{record.provider}</td>
                  <td>{record.model}</td>
                  <td>{record.category}</td>
                  <td>{record.status}</td>
                  <td title={record.promptContent}>{record.promptPreview}</td>
                  <td>{record.errorMessage ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
