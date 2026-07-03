"use client";

import { useEffect, useMemo, useState } from "react";

import { Path } from "../constant";
import { IconButton } from "./button";
import styles from "./admin.module.scss";

type AdminProviderId = "openai" | "google" | "perplexity" | "anthropic";

interface AdminEmployee {
  id: string;
  name: string;
  status?: string;
  monthlyQuota?: number | string;
  usedQuota?: number | string;
  allowedProviders?: string[];
  allowedModels?: string[];
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
}

interface AdminProvider {
  id: AdminProviderId;
  name: string;
  enabled: boolean;
  keyConfigured: boolean;
  keyPreview: string;
  baseUrl: string;
  apiVersion?: string;
  orgId?: string;
  enabledModels?: string[];
  updatedAt?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

interface UsageSummary {
  employeeId: string;
  employeeName?: string;
  month: string;
  monthlyQuota?: number;
  usedQuota: number;
  remainingQuota?: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  inputTokens: number;
}

interface UsageRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  provider: string;
  model: string;
  status: string;
  inputTokens: number;
  quotaUnits: number;
  httpStatus?: number;
  errorMessage?: string;
  createdAt: string;
}

const DEFAULT_PROVIDERS = "OpenAI,Google,Perplexity,Anthropic";

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
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

export function AdminPage() {
  const [configured, setConfigured] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [usageSummaries, setUsageSummaries] = useState<UsageSummary[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [employeeForm, setEmployeeForm] = useState({
    id: "",
    name: "",
    accessKey: "",
    monthlyQuota: "",
    allowedProviders: DEFAULT_PROVIDERS,
    allowedModels: "",
  });

  const totalRequests = useMemo(
    () => usageSummaries.reduce((sum, item) => sum + item.requestCount, 0),
    [usageSummaries],
  );
  const activeEmployees = useMemo(
    () =>
      employees.filter(
        (employee) =>
          !["disabled", "inactive", "deleted"].includes(
            String(employee.status ?? "active").toLowerCase(),
          ),
      ).length,
    [employees],
  );

  const loadDashboard = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [employeeRes, providerRes, usageRes] = await Promise.all([
        adminFetch<{ employees: AdminEmployee[] }>("employees"),
        adminFetch<{ providers: AdminProvider[] }>("providers"),
        adminFetch<{
          summaries: UsageSummary[];
          records: UsageRecord[];
        }>("usage"),
      ]);
      setEmployees(employeeRes.employees);
      setProviders(providerRes.providers);
      setUsageSummaries(usageRes.summaries);
      setUsageRecords(usageRes.records);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setAuthorized(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    adminFetch<{ configured: boolean; admin: boolean }>("session")
      .then((session) => {
        setConfigured(session.configured);
        setAuthorized(session.admin);
        if (session.admin) void loadDashboard();
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async () => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch("login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setAuthorized(true);
      setPassword("");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await adminFetch("logout", { method: "POST" });
    setAuthorized(false);
    setEmployees([]);
    setProviders([]);
    setUsageSummaries([]);
    setUsageRecords([]);
  };

  const createEmployee = async () => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch("employees", {
        method: "POST",
        body: JSON.stringify({
          ...employeeForm,
          monthlyQuota: employeeForm.monthlyQuota || undefined,
          allowedProviders: parseCsv(employeeForm.allowedProviders),
          allowedModels: parseCsv(employeeForm.allowedModels),
        }),
      });
      setEmployeeForm({
        id: "",
        name: "",
        accessKey: "",
        monthlyQuota: "",
        allowedProviders: DEFAULT_PROVIDERS,
        allowedModels: "",
      });
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const saveEmployee = async (employee: AdminEmployee) => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch(`employees/${encodeURIComponent(employee.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...employee,
          monthlyQuota: employee.monthlyQuota || undefined,
          allowedProviders: parseCsv(employee.allowedProviders),
          allowedModels: parseCsv(employee.allowedModels),
        }),
      });
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const disableEmployee = async (employee: AdminEmployee) => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch(`employees/${encodeURIComponent(employee.id)}/disable`, {
        method: "POST",
      });
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteEmployee = async (employee: AdminEmployee) => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch(`employees/${encodeURIComponent(employee.id)}`, {
        method: "DELETE",
      });
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const saveProvider = async (provider: AdminProvider) => {
    setLoading(true);
    setMessage("");
    try {
      await adminFetch(`providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify(provider),
      });
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const updateEmployee = (index: number, patch: Partial<AdminEmployee>) => {
    setEmployees((current) =>
      current.map((employee, itemIndex) =>
        itemIndex === index ? { ...employee, ...patch } : employee,
      ),
    );
  };

  const updateProvider = (index: number, patch: Partial<AdminProvider>) => {
    setProviders((current) =>
      current.map((provider, itemIndex) =>
        itemIndex === index ? { ...provider, ...patch } : provider,
      ),
    );
  };

  if (!configured) {
    return (
      <main className={styles.admin}>
        <section className={styles["login-panel"]}>
          <h1>NewbieChat Admin</h1>
          <p>ADMIN_PASSWORD is not configured.</p>
        </section>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className={styles.admin}>
        <section className={styles["login-panel"]}>
          <h1>NewbieChat Admin</h1>
          <input
            value={password}
            type="password"
            placeholder="Admin password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void login();
            }}
          />
          <IconButton
            text={loading ? "Signing in" : "Sign in"}
            type="primary"
            disabled={loading}
            onClick={login}
          />
          {message && <div className={styles.message}>{message}</div>}
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
            Employee, provider and usage management
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
            text="Back to chat"
            bordered
            onClick={() => (window.location.hash = Path.Chat)}
          />
          <IconButton text="Sign out" bordered onClick={logout} />
        </div>
      </header>

      {message && <div className={styles.message}>{message}</div>}

      <section className={styles.metrics}>
        <div>
          <strong>{employees.length}</strong>
          <span>Total employees</span>
        </div>
        <div>
          <strong>{activeEmployees}</strong>
          <span>Active employees</span>
        </div>
        <div>
          <strong>
            {providers.filter((provider) => provider.enabled).length}
          </strong>
          <span>Enabled providers</span>
        </div>
        <div>
          <strong>{totalRequests}</strong>
          <span>This month requests</span>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Employee Keys</h2>
        <div className={styles["form-grid"]}>
          <input
            value={employeeForm.id}
            placeholder="Employee ID"
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                id: event.currentTarget.value,
              })
            }
          />
          <input
            value={employeeForm.name}
            placeholder="Name"
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                name: event.currentTarget.value,
              })
            }
          />
          <input
            value={employeeForm.accessKey}
            placeholder="New employee key"
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                accessKey: event.currentTarget.value,
              })
            }
          />
          <input
            value={employeeForm.monthlyQuota}
            placeholder="Monthly quota"
            type="number"
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                monthlyQuota: event.currentTarget.value,
              })
            }
          />
          <input
            value={employeeForm.allowedProviders}
            placeholder="Allowed providers"
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                allowedProviders: event.currentTarget.value,
              })
            }
          />
          <input
            value={employeeForm.allowedModels}
            placeholder="Allowed models"
            onChange={(event) =>
              setEmployeeForm({
                ...employeeForm,
                allowedModels: event.currentTarget.value,
              })
            }
          />
          <IconButton
            text="Create employee"
            type="primary"
            disabled={loading}
            onClick={createEmployee}
          />
        </div>

        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Monthly quota</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee, index) => (
                <tr key={employee.id}>
                  <td>{employee.id}</td>
                  <td>
                    <input
                      value={employee.name}
                      onChange={(event) =>
                        updateEmployee(index, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={employee.status ?? "active"}
                      onChange={(event) =>
                        updateEmployee(index, {
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
                      value={quotaValue(employee.monthlyQuota)}
                      type="number"
                      onChange={(event) =>
                        updateEmployee(index, {
                          monthlyQuota: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={csv(employee.allowedProviders)}
                      onChange={(event) =>
                        updateEmployee(index, {
                          allowedProviders: parseCsv(event.currentTarget.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={csv(employee.allowedModels)}
                      onChange={(event) =>
                        updateEmployee(index, {
                          allowedModels: parseCsv(event.currentTarget.value),
                        })
                      }
                    />
                  </td>
                  <td className={styles["row-actions"]}>
                    <button
                      disabled={loading}
                      onClick={() => saveEmployee(employee)}
                    >
                      Save
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => disableEmployee(employee)}
                    >
                      Disable
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => deleteEmployee(employee)}
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
        <h2>Provider Config</h2>
        <div className={styles["provider-grid"]}>
          {providers.map((provider, index) => (
            <div className={styles.provider} key={provider.id}>
              <div className={styles["provider-header"]}>
                <strong>{provider.name}</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) =>
                      updateProvider(index, {
                        enabled: event.currentTarget.checked,
                      })
                    }
                  />
                  Enabled
                </label>
              </div>
              <div className={styles.subtle}>
                Key: {provider.keyConfigured ? provider.keyPreview : "not set"}
              </div>
              <input
                value={provider.apiKey ?? ""}
                placeholder="New provider key"
                onChange={(event) =>
                  updateProvider(index, {
                    apiKey: event.currentTarget.value,
                    clearApiKey: false,
                  })
                }
              />
              <input
                value={provider.baseUrl ?? ""}
                placeholder="Base URL"
                onChange={(event) =>
                  updateProvider(index, { baseUrl: event.currentTarget.value })
                }
              />
              <input
                value={csv(provider.enabledModels)}
                placeholder="Enabled models"
                onChange={(event) =>
                  updateProvider(index, {
                    enabledModels: parseCsv(event.currentTarget.value),
                  })
                }
              />
              {provider.id === "anthropic" && (
                <input
                  value={provider.apiVersion ?? ""}
                  placeholder="Anthropic API Version"
                  onChange={(event) =>
                    updateProvider(index, {
                      apiVersion: event.currentTarget.value,
                    })
                  }
                />
              )}
              {provider.id === "openai" && (
                <input
                  value={provider.orgId ?? ""}
                  placeholder="OpenAI Organization"
                  onChange={(event) =>
                    updateProvider(index, { orgId: event.currentTarget.value })
                  }
                />
              )}
              <label className={styles["inline-check"]}>
                <input
                  type="checkbox"
                  checked={!!provider.clearApiKey}
                  onChange={(event) =>
                    updateProvider(index, {
                      clearApiKey: event.currentTarget.checked,
                      apiKey: event.currentTarget.checked
                        ? ""
                        : provider.apiKey,
                    })
                  }
                />
                Clear stored key
              </label>
              <IconButton
                text="Save provider"
                bordered
                disabled={loading}
                onClick={() => saveProvider(provider)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Monthly Usage</h2>
        <div className={styles["table-wrap"]}>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Quota</th>
                <th>Used</th>
                <th>Requests</th>
                <th>Success</th>
                <th>Failed</th>
                <th>Estimated input tokens</th>
              </tr>
            </thead>
            <tbody>
              {usageSummaries.map((summary) => (
                <tr key={summary.employeeId}>
                  <td>{summary.employeeName || summary.employeeId}</td>
                  <td>{summary.monthlyQuota ?? "unlimited"}</td>
                  <td>{summary.usedQuota}</td>
                  <td>{summary.requestCount}</td>
                  <td>{summary.successCount}</td>
                  <td>{summary.failedCount}</td>
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
                <th>Employee</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Status</th>
                <th>HTTP</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {usageRecords.map((record) => (
                <tr key={record.id}>
                  <td>{new Date(record.createdAt).toLocaleString()}</td>
                  <td>{record.employeeName || record.employeeId}</td>
                  <td>{record.provider}</td>
                  <td>{record.model}</td>
                  <td>{record.status}</td>
                  <td>{record.httpStatus ?? ""}</td>
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
