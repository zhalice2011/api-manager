import {useCallback, useEffect, useRef, useState} from "react";
import {request} from "../utils/request";
import type {AppConfig, SiteAccount} from "../types/backup";
import {
  Check,
  Copy,
  Globe,
  Key,
  Pencil,
  Plus,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X
} from "lucide-react";
import ErrorAlert from "../components/ErrorAlert";
import {useDebounceCallback} from "../hooks/useDebounceCallback";
import {useConfig} from "../hooks/useConfig";
import {useLocale} from "../hooks/useLocale";

export default function AccountsPage() {
  const { config, setConfig, error, setError, reload, save } = useConfig();
  const [importStatus, setImportStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [browserSyncStatus, setBrowserSyncStatus] = useState<"" | "detecting" | "syncing" | "fetching_keys">("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ siteUrl: "", apiKey: "", siteName: "", siteType: "new-api" });
  const [validating, setValidating] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editKeyValue, setEditKeyValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();

  function copyApiKey(account: SiteAccount) {
    const key = account.account_info.api_key;
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => {
      setCopiedId(account.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  const debouncedSave = useDebounceCallback(
    useCallback((cfg: AppConfig) => {
      request("save_config", { config_data: cfg }).catch(() => {});
    }, []),
    500,
  );

  useEffect(() => {
    if (!importStatus) return;
    const timer = setTimeout(() => setImportStatus(""), 5000);
    return () => clearTimeout(timer);
  }, [importStatus]);

  async function handleImport() {
    const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

    if (isTauri) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const path = await open({
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (path) {
          const accounts = await request<SiteAccount[]>("import_backup", {
            path: path as string,
          });
          await saveAccounts(accounts);
        }
      } catch (e) {
        setError(String(e));
      }
    } else {
      fileInputRef.current?.click();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    try {
      const accounts = await request<SiteAccount[]>("import_backup_from_text", {
        json: text,
      });
      await saveAccounts(accounts);
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveAccounts(accounts: SiteAccount[]) {
    if (!config) return;
    const updated = {
      ...config,
      accounts,
      proxy_accounts: accounts.filter((a) => !a.disabled),
    };
    await save(updated);
    setConfig(updated);
    setImportStatus(`Imported ${accounts.length} accounts`);
  }

  async function toggleAccount(account: SiteAccount) {
    if (!config) return;
    const newDisabled = !account.disabled;
    const updatedAccounts = config.accounts.map((a) =>
      a.id === account.id ? { ...a, disabled: newDisabled } : a
    );
    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
    await save(updated);
    setConfig(updated);
  }

  function updatePriority(account: SiteAccount, priority: number) {
    if (!config) return;
    const updatedAccounts = config.accounts.map((a) =>
      a.id === account.id ? { ...a, proxy_priority: priority } : a
    );
    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
    setConfig(updated);
    debouncedSave(updated);
  }

  function updateWeight(account: SiteAccount, weight: number) {
    if (!config) return;
    const clamped = Math.max(0, Math.min(100, weight));
    const updatedAccounts = config.accounts.map((a) =>
      a.id === account.id ? { ...a, proxy_weight: clamped } : a
    );
    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
    setConfig(updated);
    debouncedSave(updated);
  }

  async function handleRefreshKeys() {
    setRefreshing(true);
    setError("");
    setImportStatus("");
    try {
      const result = await request<{
        success: number;
        failed: number;
        skipped: number;
        total: number;
      }>("refresh_api_keys");
      setImportStatus(
        `Refreshed API Keys: ${result.success} success, ${result.failed} failed, ${result.skipped} skipped (sub2api)`
      );
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleClearAllAccounts() {
    if (!config) return;
    setClearing(true);
    setError("");
    setImportStatus("");
    try {
      const updated = {
        ...config,
        accounts: [],
        proxy_accounts: [],
        proxy: {
          ...config.proxy,
          model_routes: [],
        },
      };
      await save(updated);
      setConfig(updated);
      setImportStatus(t("accounts.clearSuccess"));
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  }

  async function handleBrowserSync() {
    setBrowserSyncStatus("detecting");
    setError("");
    setImportStatus("");
    try {
      const detection = await request<{ found: boolean; profiles: unknown[] }>(
        "detect_browser_extension"
      );
      if (!detection.found) {
        setError(t("accounts.extensionNotFound"));
        setBrowserSyncStatus("");
        return;
      }

      setBrowserSyncStatus("syncing");
      const accounts = await request<SiteAccount[]>("sync_from_browser");
      await saveAccounts(accounts);
      setImportStatus(
        t("accounts.syncSuccess").replace("{count}", String(accounts.length))
      );
    } catch (e) {
      setError(`${t("accounts.syncFailed")}: ${String(e)}`);
    } finally {
      setBrowserSyncStatus("");
    }
  }

  async function handleAddAccount() {
    if (!config) return;
    const url = addForm.siteUrl.trim();
    const key = addForm.apiKey.trim();
    if (!url) { setError(t("accounts.siteUrlRequired")); return; }
    if (!key) { setError(t("accounts.apiKeyRequired")); return; }

    // Validate URL format
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      setError(t("accounts.siteUrlRequired"));
      return;
    }

    // Validate API key against upstream
    setValidating(true);
    setError("");
    try {
      const result = await request<{ valid: boolean; model_count: number; error: string | null }>(
        "validate_api_key",
        { site_url: url, api_key: key, site_type: addForm.siteType }
      );

      if (!result.valid) {
        setError(t("accounts.validationFailed").replace("{reason}", result.error || "Unknown"));
        return;
      }

      setImportStatus(
        t("accounts.validationSuccess").replace("{count}", String(result.model_count))
      );
    } catch (e) {
      setError(t("accounts.validationFailed").replace("{reason}", String(e)));
      return;
    } finally {
      setValidating(false);
    }

    // Validation passed — add account
    const siteName = addForm.siteName.trim() || hostname;
    const newAccount: SiteAccount = {
      id: crypto.randomUUID(),
      site_name: siteName,
      site_url: url.replace(/\/+$/, ""),
      site_type: addForm.siteType,
      authType: "access_token",
      account_info: {
        id: 0,
        access_token: "",
        api_key: key,
        username: "",
        quota: 0,
        today_prompt_tokens: 0,
        today_completion_tokens: 0,
        today_quota_consumption: 0,
        today_requests_count: 0,
        today_income: 0,
      },
    };

    const updatedAccounts = [...config.accounts, newAccount];
    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
    await save(updated);
    setConfig(updated);
    setAddForm({ siteUrl: "", apiKey: "", siteName: "", siteType: "new-api" });
    setShowAddForm(false);
    setImportStatus(t("accounts.addSuccess"));
  }

  function startEditKey(account: SiteAccount) {
    setEditingKeyId(account.id);
    setEditKeyValue(account.account_info.api_key || "");
  }

  async function handleSaveEditKey(account: SiteAccount) {
    if (!config) return;
    const key = editKeyValue.trim();
    if (!key) { setError(t("accounts.apiKeyRequired")); return; }

    // Validate against upstream
    setValidating(true);
    setError("");
    try {
      const result = await request<{ valid: boolean; model_count: number; error: string | null }>(
        "validate_api_key",
        { site_url: account.site_url, api_key: key, site_type: account.site_type }
      );
      if (!result.valid) {
        setError(t("accounts.validationFailed").replace("{reason}", result.error || "Unknown"));
        return;
      }
    } catch (e) {
      setError(t("accounts.validationFailed").replace("{reason}", String(e)));
      return;
    } finally {
      setValidating(false);
    }

    // Update account
    const updatedAccounts = config.accounts.map((a) =>
      a.id === account.id
        ? { ...a, account_info: { ...a.account_info, api_key: key } }
        : a
    );
    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
    await save(updated);
    setConfig(updated);
    setEditingKeyId(null);
    setEditKeyValue("");
    setImportStatus(t("accounts.keySaved"));
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t("accounts.title")}</h1>
          <p className="text-base-content/60 mt-1">{t("accounts.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-error btn-outline btn-sm gap-2"
            onClick={handleClearAllAccounts}
            disabled={clearing || !config || config.accounts.length === 0 || refreshing || !!browserSyncStatus}
          >
            <Trash2 size={14} />
            {clearing ? t("accounts.clearing") : t("accounts.clearAll")}
          </button>
          <button
            className="btn btn-outline btn-sm gap-2"
            onClick={handleRefreshKeys}
            disabled={refreshing || !config || config.accounts.length === 0}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? t("accounts.refreshing") : t("accounts.refreshKeys")}
          </button>
          <button
            className="btn btn-outline btn-sm gap-2"
            onClick={handleBrowserSync}
            disabled={!!browserSyncStatus}
          >
            <Globe size={14} className={browserSyncStatus ? "animate-pulse" : ""} />
            {browserSyncStatus === "detecting"
              ? t("accounts.detecting")
              : browserSyncStatus === "syncing" || browserSyncStatus === "fetching_keys"
                ? t("accounts.syncing")
                : t("accounts.syncFromBrowser")}
          </button>
          <button
            className="btn btn-success btn-sm gap-2"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus size={14} />
            {t("accounts.addAccount")}
          </button>
          <button className="btn btn-primary btn-sm gap-2" onClick={handleImport}>
            <Upload size={14} />
            {t("accounts.importBackup")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {error && (
        <ErrorAlert
          message={error}
          onRetry={reload}
          onDismiss={() => setError("")}
        />
      )}

      {importStatus && (
        <div role="alert" className="alert alert-success">
          <span className="flex-1">{importStatus}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setImportStatus("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {showAddForm && (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body py-4">
            <h3 className="font-semibold mb-3">{t("accounts.addAccountTitle")}</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <label className="label label-text text-xs">{t("accounts.siteUrl")}</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder={t("accounts.siteUrlPlaceholder")}
                  value={addForm.siteUrl}
                  onChange={(e) => setAddForm((f) => ({ ...f, siteUrl: e.target.value }))}
                />
              </div>
              <div>
                <label className="label label-text text-xs">{t("accounts.apiKeyInput")}</label>
                <input
                  className="input input-bordered input-sm w-full font-mono"
                  placeholder={t("accounts.apiKeyPlaceholder")}
                  value={addForm.apiKey}
                  onChange={(e) => setAddForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
              </div>
              <div>
                <label className="label label-text text-xs">{t("accounts.siteName")}</label>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder={t("accounts.siteNamePlaceholder")}
                  value={addForm.siteName}
                  onChange={(e) => setAddForm((f) => ({ ...f, siteName: e.target.value }))}
                />
              </div>
              <div>
                <label className="label label-text text-xs">{t("accounts.siteType")}</label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={addForm.siteType}
                  onChange={(e) => setAddForm((f) => ({ ...f, siteType: e.target.value }))}
                >
                  <option value="new-api">New API</option>
                  <option value="one-api">One API</option>
                  <option value="Veloera">Veloera</option>
                  <option value="one-hub">OneHub</option>
                  <option value="done-hub">DoneHub</option>
                  <option value="sub2api">Sub2API</option>
                  <option value="anyrouter">AnyRouter</option>
                  <option value="VoAPI">VoAPI</option>
                  <option value="Super-API">Super-API</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddForm(false)} disabled={validating}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-success btn-sm" onClick={handleAddAccount} disabled={validating}>
                {validating ? t("accounts.validating") : t("accounts.add")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!config || config.accounts.length === 0 ? (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body items-center text-center py-12">
            <p className="text-base-content/60">{t("accounts.noAccounts")}</p>
            <p className="text-sm text-base-content/40 mt-1">
              {t("accounts.noAccountsHint")}
            </p>
          </div>
        </div>
      ) : (
          <div className="card bg-base-100 border border-base-300">
          <div>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>{t("accounts.site")}</th>
                  <th>{t("accounts.type")}</th>

                  <th>{t("accounts.apiKey")}</th>
                  <th>{t("accounts.quota")}</th>
                  <th>{t("accounts.health")}</th>
                  <th>{t("accounts.priority")}</th>
                  <th>{t("accounts.weight")}</th>
                  <th>{t("accounts.status")}</th>
                  <th>{t("accounts.action")}</th>
                </tr>
              </thead>
              <tbody>
                {config.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="font-medium">{account.site_name}</div>
                      <div className="text-xs text-base-content/50">
                        {account.site_url}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-outline badge-sm whitespace-nowrap">
                        {account.site_type}
                      </span>
                    </td>

                    <td>
                      {editingKeyId === account.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            className="input input-bordered input-xs w-36 font-mono"
                            placeholder={t("accounts.editKeyPlaceholder")}
                            value={editKeyValue}
                            onChange={(e) => setEditKeyValue(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEditKey(account);
                              if (e.key === "Escape") { setEditingKeyId(null); setEditKeyValue(""); }
                            }}
                          />
                          <button
                            className="btn btn-success btn-xs"
                            onClick={() => handleSaveEditKey(account)}
                            disabled={validating}
                          >
                            {validating ? "..." : <Check size={12} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => { setEditingKeyId(null); setEditKeyValue(""); }}
                            disabled={validating}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : account.account_info.api_key ? (
                        <div className="flex items-center gap-1">
                          <button
                            className="font-mono text-xs text-success flex items-center gap-1 cursor-pointer hover:opacity-70"
                            onClick={() => copyApiKey(account)}
                            title="Click to copy full API key"
                          >
                            {copiedId === account.id ? (
                              <Check size={12} />
                            ) : (
                              <Key size={12} />
                            )}
                            {account.account_info.api_key.length > 12
                              ? `${account.account_info.api_key.slice(0, 8)}...${account.account_info.api_key.slice(-4)}`
                              : account.account_info.api_key}
                            {copiedId !== account.id && (
                              <Copy size={10} className="opacity-40" />
                            )}
                          </button>
                          <button
                            className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                            onClick={() => startEditKey(account)}
                            title={t("accounts.editKey")}
                          >
                            <Pencil size={10} className="opacity-40 hover:opacity-100" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-base-content/40">
                            {account.site_type === "sub2api" ? t("accounts.jwt") : t("accounts.notFetched")}
                          </span>
                          <button
                            className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                            onClick={() => startEditKey(account)}
                            title={t("accounts.editKey")}
                          >
                            <Pencil size={10} className="opacity-40 hover:opacity-100" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="font-mono">${(account.account_info.quota / 500000).toFixed(2)}</td>
                    <td>
                      {account.health ? (
                        <span
                          className={`badge badge-sm ${
                            account.health.status === "normal"
                              ? "badge-success"
                              : "badge-warning"
                          }`}
                        >
                          {account.health.status}
                        </span>
                      ) : (
                        <span className="text-base-content/40">-</span>
                      )}
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-16 font-mono"
                        type="number"
                        value={account.proxy_priority ?? 0}
                        onChange={(e) =>
                          updatePriority(account, Number(e.target.value))
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-16 font-mono"
                        type="number"
                        min={0}
                        max={100}
                        value={account.proxy_weight ?? 10}
                        onChange={(e) =>
                          updateWeight(account, Number(e.target.value))
                        }
                      />
                    </td>
                    <td>
                      <span
                        className={`badge badge-sm ${
                          account.disabled ? "badge-error" : "badge-success"
                        }`}
                      >
                        {account.disabled ? t("common.disabled") : t("common.enabled")}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-xs gap-1"
                        onClick={() => toggleAccount(account)}
                      >
                        {account.disabled ? (
                          <ToggleLeft size={14} />
                        ) : (
                          <ToggleRight size={14} />
                        )}
                        {account.disabled ? t("common.enable") : t("common.disable")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
