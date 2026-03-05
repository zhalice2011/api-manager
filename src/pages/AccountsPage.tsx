import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {request} from "../utils/request";
import type {AppConfig, SiteAccount} from "../types/backup";
import {Copy, Globe, Key, Pencil, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2, Upload, X,} from "lucide-react";
import ErrorAlert from "../components/ErrorAlert";
import {useDebounceCallback} from "../hooks/useDebounceCallback";
import {useConfig} from "../hooks/useConfig";
import {useLocale} from "../hooks/useLocale";

type SortKey = "site" | "type" | "quota" | "health" | "priority" | "weight" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "enabled" | "disabled";

const ACCOUNTS_STORAGE = {
    siteFilter: "accounts.siteFilter",
    typeFilter: "accounts.typeFilter",
    healthFilter: "accounts.healthFilter",
    statusFilter: "accounts.statusFilter",
    sortKey: "accounts.sortKey",
    sortDir: "accounts.sortDir",
} as const;

function storageGet(key: string): string | null {
    try {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(key);
    } catch (e) {
        console.warn("Failed to read from localStorage", e);
        return null;
    }
}

function storageSet(key: string, value: string) {
    try {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(key, value);
    } catch (e) {
        console.warn("Failed to write to localStorage", e);
    }
}

function isSortKey(v: string): v is SortKey {
    return (
        v === "site" ||
        v === "type" ||
        v === "quota" ||
        v === "health" ||
        v === "priority" ||
        v === "weight" ||
        v === "status"
    );
}

function isSortDir(v: string): v is SortDir {
    return v === "asc" || v === "desc";
}

function isStatusFilter(v: string): v is StatusFilter {
    return v === "all" || v === "enabled" || v === "disabled";
}

export default function AccountsPage() {
  const { config, setConfig, error, setError, reload, save } = useConfig();
  const [importStatus, setImportStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [browserSyncStatus, setBrowserSyncStatus] = useState<"" | "detecting" | "syncing" | "fetching_keys">("");
    const [accountModalOpen, setAccountModalOpen] = useState(false);
    const [accountModalMode, setAccountModalMode] = useState<"add" | "edit" | "duplicate">("add");
    const [accountModalTargetId, setAccountModalTargetId] = useState<string | null>(null);
    const [accountForm, setAccountForm] = useState({
        siteUrl: "",
        apiKey: "",
        siteName: "",
        siteType: "new-api",
    });
    const [accountModalError, setAccountModalError] = useState("");
    const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
    const [clearingAll, setClearingAll] = useState(false);
  const [validating, setValidating] = useState(false);
    const [siteFilter, setSiteFilter] = useState(() => storageGet(ACCOUNTS_STORAGE.siteFilter) || "");
    const [typeFilter, setTypeFilter] = useState<string>(() => storageGet(ACCOUNTS_STORAGE.typeFilter) || "all");
    const [healthFilter, setHealthFilter] = useState<string>(() => storageGet(ACCOUNTS_STORAGE.healthFilter) || "all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
        const stored = storageGet(ACCOUNTS_STORAGE.statusFilter);
        return stored && isStatusFilter(stored) ? stored : "all";
    });
    const [sortKey, setSortKey] = useState<SortKey>(() => {
        const stored = storageGet(ACCOUNTS_STORAGE.sortKey);
        return stored && isSortKey(stored) ? stored : "site";
    });
    const [sortDir, setSortDir] = useState<SortDir>(() => {
        const stored = storageGet(ACCOUNTS_STORAGE.sortDir);
        return stored && isSortDir(stored) ? stored : "asc";
    });

    const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
    const [editingApiKeyValue, setEditingApiKeyValue] = useState("");
    const [savingApiKey, setSavingApiKey] = useState(false);
    const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
    const accountModalBackdropRef = useRef<HTMLDivElement>(null);
    const accountModalRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

    const accountModalTitle = useMemo(() => t("accounts.addAccountTitle"), [t]);

    const closeAccountModal = useCallback(() => {
        if (validating) return;
        setAccountModalOpen(false);
        setAccountModalTargetId(null);
        setAccountModalError("");
    }, [validating]);

    const closeClearAllConfirm = useCallback(() => {
        if (clearingAll) return;
        setClearAllConfirmOpen(false);
    }, [clearingAll]);

    const typeOptions = useMemo(() => {
        if (!config) return [] as string[];
        return Array.from(new Set(config.accounts.map((a) => a.site_type))).sort((a, b) => a.localeCompare(b));
    }, [config]);

    const healthOptions = useMemo(() => {
        if (!config) return [] as string[];
        return Array.from(
            new Set(config.accounts.map((a) => a.health?.status).filter((v): v is string => Boolean(v))),
        ).sort((a, b) => a.localeCompare(b));
    }, [config]);

    const filteredSortedAccounts = useMemo(() => {
        if (!config) return [] as SiteAccount[];

        const query = siteFilter.trim().toLowerCase();

        const filtered = config.accounts.filter((a) => {
            if (query) {
                const hay = `${a.site_name} ${a.site_url}`.toLowerCase();
                if (!hay.includes(query)) return false;
            }
            if (typeFilter !== "all" && a.site_type !== typeFilter) return false;

            const hs = a.health?.status;
            if (healthFilter !== "all") {
                if (healthFilter === "unknown") {
                    if (hs) return false;
                } else if (hs !== healthFilter) {
                    return false;
                }
            }

            if (statusFilter !== "all") {
                const enabled = !a.disabled;
                if (statusFilter === "enabled" && !enabled) return false;
                if (statusFilter === "disabled" && enabled) return false;
            }

            return true;
        });

        const dirMul = sortDir === "asc" ? 1 : -1;
        const normalizeHealthRank = (a: SiteAccount) => {
            const s = a.health?.status;
            if (!s) return 99;
            if (s === "normal") return 0;
            return 10;
        };
        const normalizeStatusRank = (a: SiteAccount) => (a.disabled ? 1 : 0);
        const normalizeQuota = (a: SiteAccount) => a.account_info.quota ?? 0;
        const normalizePriority = (a: SiteAccount) => a.proxy_priority ?? 0;
        const normalizeWeight = (a: SiteAccount) => a.proxy_weight ?? 10;

        const primaryCompare = (a: SiteAccount, b: SiteAccount) => {
            switch (sortKey) {
                case "site":
                    return a.site_name.localeCompare(b.site_name, undefined, {sensitivity: "base"});
                case "type":
                    return a.site_type.localeCompare(b.site_type, undefined, {sensitivity: "base"});
                case "health":
                    return normalizeHealthRank(a) - normalizeHealthRank(b);
                case "status":
                    return normalizeStatusRank(a) - normalizeStatusRank(b);
                case "quota":
                    return normalizeQuota(a) - normalizeQuota(b);
                case "priority":
                    return normalizePriority(a) - normalizePriority(b);
                case "weight":
                    return normalizeWeight(a) - normalizeWeight(b);
                default:
                    return 0;
            }
        };

        const withIndex = filtered.map((item, originalIndex) => ({item, originalIndex}));
        withIndex.sort((aa, bb) => {
            const a = aa.item;
            const b = bb.item;
            const cmp = primaryCompare(a, b) * dirMul;
            if (cmp) return cmp;
            const nameCmp = a.site_name.localeCompare(b.site_name, undefined, {sensitivity: "base"});
            if (nameCmp) return nameCmp;
            const idCmp = a.id.localeCompare(b.id);
            if (idCmp) return idCmp;
            return aa.originalIndex - bb.originalIndex;
        });
        return withIndex.map((x) => x.item);
    }, [config, healthFilter, siteFilter, sortDir, sortKey, statusFilter, typeFilter]);

    function toggleSort(nextKey: typeof sortKey) {
        if (sortKey === nextKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            return;
        }
        setSortKey(nextKey);
        setSortDir("asc");
    }

    useEffect(() => {
        if (!editingApiKeyId) return;
        const raf = requestAnimationFrame(() => {
            apiKeyInputRef.current?.focus();
            apiKeyInputRef.current?.select();
        });
        return () => cancelAnimationFrame(raf);
    }, [editingApiKeyId]);

    useEffect(() => {
        if (!accountModalOpen && !clearAllConfirmOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key !== "Escape") return;
            if (clearAllConfirmOpen) {
                closeClearAllConfirm();
                return;
            }
            if (accountModalOpen) closeAccountModal();
        }

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [accountModalOpen, closeAccountModal, clearAllConfirmOpen, closeClearAllConfirm]);

    useEffect(() => {
        if (!accountModalOpen) return;
        const el = accountModalRef.current;
        const focusable = el?.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]");
        focusable?.focus();
    }, [accountModalOpen]);

  function copyApiKey(account: SiteAccount) {
    const key = account.account_info.api_key;
    if (!key) return;
      navigator.clipboard.writeText(key).catch((e) => {
          console.warn("Failed to copy API key", e);
    });
  }

    function copySiteUrl(account: SiteAccount) {
        const url = account.site_url;
        if (!url) return;
        navigator.clipboard.writeText(url).catch((e) => {
            console.warn("Failed to copy site URL", e);
        });
    }

    function startEditApiKey(account: SiteAccount) {
        const key = account.account_info.api_key || "";
        setEditingApiKeyId(account.id);
        setEditingApiKeyValue(key);
    }

    function cancelEditApiKey() {
        setEditingApiKeyId(null);
        setEditingApiKeyValue("");
        setSavingApiKey(false);
    }

    async function saveEditedApiKey(accountId: string) {
        if (!config) return;
        if (savingApiKey) return;

        const nextKey = editingApiKeyValue.trim();
        if (!nextKey) {
            setError(t("accounts.apiKeyRequired"));
            return;
        }

        setSavingApiKey(true);
        setError("");
        setImportStatus("");

        try {
            const updatedAccounts = config.accounts.map((a) =>
                a.id === accountId
                    ? {
                        ...a,
                        account_info: {
                            ...a.account_info,
                            api_key: nextKey,
                        },
                    }
                    : a,
            );
            const updated = {
                ...config,
                accounts: updatedAccounts,
                proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
            };
            await save(updated);
            setConfig(updated);
            cancelEditApiKey();
            setImportStatus(t("accounts.keySaved"));
        } catch (e) {
            setError(String(e));
            setSavingApiKey(false);
        }
    }

  const debouncedSave = useDebounceCallback(
    useCallback((cfg: AppConfig) => {
      request("save_config", { config_data: cfg }).catch(() => {});
    }, []),
    500,
  );

    useEffect(() => {
        storageSet(ACCOUNTS_STORAGE.siteFilter, siteFilter);
    }, [siteFilter]);

    useEffect(() => {
        storageSet(ACCOUNTS_STORAGE.typeFilter, typeFilter);
    }, [typeFilter]);

    useEffect(() => {
        storageSet(ACCOUNTS_STORAGE.healthFilter, healthFilter);
    }, [healthFilter]);

    useEffect(() => {
        storageSet(ACCOUNTS_STORAGE.statusFilter, statusFilter);
    }, [statusFilter]);

    useEffect(() => {
        storageSet(ACCOUNTS_STORAGE.sortKey, sortKey);
    }, [sortKey]);

    useEffect(() => {
        storageSet(ACCOUNTS_STORAGE.sortDir, sortDir);
    }, [sortDir]);

    useEffect(() => {
        if (!editingApiKeyId) return;
        const raf = requestAnimationFrame(() => {
            apiKeyInputRef.current?.focus();
            apiKeyInputRef.current?.select();
        });
        return () => cancelAnimationFrame(raf);
    }, [editingApiKeyId]);

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

    async function handleToggleAllAccounts() {
    if (!config) return;
        const allDisabled = config.accounts.every((a) => a.disabled);
        const newDisabled = !allDisabled;
        const updatedAccounts = config.accounts.map((a) => ({...a, disabled: newDisabled}));
        const updated = {
            ...config,
            accounts: updatedAccounts,
            proxy_accounts: newDisabled ? [] : updatedAccounts,
        };
        await save(updated);
        setConfig(updated);
        setImportStatus(allDisabled ? t("accounts.enableAllSuccess") : t("accounts.disableAllSuccess"));
    }

    function openAddAccountModal() {
        setAccountModalMode("add");
        setAccountModalTargetId(null);
        setAccountForm({siteUrl: "", apiKey: "", siteName: "", siteType: "new-api"});
        setAccountModalError("");
        setAccountModalOpen(true);
    }

    function openEditAccountModal(account: SiteAccount) {
        setAccountModalMode("edit");
        setAccountModalTargetId(account.id);
        setAccountForm({
            siteUrl: account.site_url,
            apiKey: account.account_info.api_key || "",
            siteName: account.site_name,
            siteType: account.site_type,
        });
        setAccountModalError("");
        setAccountModalOpen(true);
  }

    function openDuplicateAccountModal(account: SiteAccount) {
        setAccountModalMode("duplicate");
        setAccountModalTargetId(account.id);
        setAccountForm({
            siteUrl: account.site_url,
            apiKey: "",
            siteName: `${account.site_name} (Copy)`,
            siteType: account.site_type,
        });
        setAccountModalError("");
        setAccountModalOpen(true);
    }

    async function handleSubmitAccountModal() {
        if (!config) return;

        const url = accountForm.siteUrl.trim();
        const key = accountForm.apiKey.trim();
        if (!url) {
            setAccountModalError(t("accounts.siteUrlRequired"));
            return;
        }
        if (!key) {
            setAccountModalError(t("accounts.apiKeyRequired"));
            return;
        }

    // Validate URL format
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
        setAccountModalError(t("accounts.siteUrlRequired"));
      return;
    }

    // Validate API key against upstream
    setValidating(true);
        setAccountModalError("");
    try {
      const result = await request<{ valid: boolean; model_count: number; error: string | null }>(
        "validate_api_key",
          {site_url: url, api_key: key, site_type: accountForm.siteType},
      );

      if (!result.valid) {
          setAccountModalError(
              t("accounts.validationFailed").replace("{reason}", result.error || "Unknown"),
          );
        return;
      }

      setImportStatus(
          t("accounts.validationSuccess").replace("{count}", String(result.model_count)),
      );
    } catch (e) {
        setAccountModalError(t("accounts.validationFailed").replace("{reason}", String(e)));
      return;
    } finally {
      setValidating(false);
    }

        const siteName = accountForm.siteName.trim() || hostname;
        const normalizedUrl = url.replace(/\/+$/, "");

        const updatedAccounts = (() => {
            if (accountModalMode === "edit") {
                if (!accountModalTargetId) return config.accounts;
                return config.accounts.map((a) =>
                    a.id === accountModalTargetId
                        ? {
                            ...a,
                            site_name: siteName,
                            site_url: normalizedUrl,
                            site_type: accountForm.siteType,
                            account_info: {...a.account_info, api_key: key},
                        }
                        : a,
                );
            }

            const base =
                accountModalMode === "duplicate" && accountModalTargetId
                    ? config.accounts.find((a) => a.id === accountModalTargetId)
                    : undefined;

            const newAccount: SiteAccount = base
                ? {
                    ...base,
                    id: crypto.randomUUID(),
                    site_name: siteName,
                    site_url: normalizedUrl,
                    site_type: accountForm.siteType,
                    account_info: {
                        ...base.account_info,
                        api_key: key,
                        quota: 0,
                        today_prompt_tokens: 0,
                        today_completion_tokens: 0,
                        today_quota_consumption: 0,
                        today_requests_count: 0,
                        today_income: 0,
                    },
                    health: undefined,
                    disabled: true,
                    created_at: Date.now(),
                }
                : {
                    id: crypto.randomUUID(),
                    site_name: siteName,
                    site_url: normalizedUrl,
                    site_type: accountForm.siteType,
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
                    health: undefined,
                    disabled: false,
                    created_at: Date.now(),
                };

            return [...config.accounts, newAccount];
        })();

    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
    await save(updated);
    setConfig(updated);

        closeAccountModal();
        setAccountForm({siteUrl: "", apiKey: "", siteName: "", siteType: "new-api"});

        setImportStatus(
            accountModalMode === "edit"
                ? t("accounts.keySaved")
                : accountModalMode === "duplicate"
                    ? t("accounts.duplicateSuccess")
                    : t("accounts.addSuccess"),
        );
  }

    async function handleDeleteAccount(account: SiteAccount) {
    if (!config) return;
    setError("");
        setImportStatus("");
        const updatedAccounts = config.accounts.filter((a) => a.id !== account.id);
    const updated = {
      ...config,
      accounts: updatedAccounts,
      proxy_accounts: updatedAccounts.filter((a) => !a.disabled),
    };
        try {
            await save(updated);
            setConfig(updated);
            setImportStatus(t("accounts.deleteSuccess"));
        } catch (e) {
            setError(String(e));
        }
    }

    function openClearAllConfirm() {
        if (!config) return;
        setClearAllConfirmOpen(true);
    }

    async function confirmClearAllAccounts() {
        if (!config) return;
        setClearingAll(true);
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
            setClearAllConfirmOpen(false);
        } catch (e) {
            setError(String(e));
        } finally {
            setClearingAll(false);
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



  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t("accounts.title")}</h1>
          <p className="text-base-content/60 mt-1">{t("accounts.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button
              className={`btn btn-sm gap-2 ${config?.accounts.every((a) => a.disabled) ? "btn-success" : "btn-warning"} btn-outline`}
              onClick={handleToggleAllAccounts}
              disabled={!config || config.accounts.length === 0 || refreshing || !!browserSyncStatus}
          >
              {config?.accounts.every((a) => a.disabled) ? <ToggleRight size={14}/> : <ToggleLeft size={14}/>}
              {config?.accounts.every((a) => a.disabled) ? t("accounts.enableAll") : t("accounts.disableAll")}
          </button>
            <button
            className="btn btn-error btn-outline btn-sm gap-2"
            onClick={openClearAllConfirm}
            disabled={
                clearingAll ||
                !config ||
                config.accounts.length === 0 ||
                refreshing ||
                !!browserSyncStatus
            }
          >
            <Trash2 size={14} />
                {clearingAll ? t("accounts.clearing") : t("accounts.clearAll")}
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
            <button className="btn btn-success btn-sm gap-2" onClick={openAddAccountModal}>
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

        {accountModalOpen && (
            <div
                ref={accountModalBackdropRef}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                onClick={(e) => {
                    if (e.target === accountModalBackdropRef.current) closeAccountModal();
                }}
                role="dialog"
                aria-modal="true"
                aria-label={accountModalTitle}
            >
                <div
                    ref={accountModalRef}
                    className="bg-base-100 rounded-2xl shadow-2xl border border-base-300 w-full max-w-3xl overflow-hidden"
                >
                    <div
                        className="px-6 py-4 border-b border-base-200 flex items-center justify-between bg-base-200/30">
                        <h3 className="font-bold">{accountModalTitle}</h3>
                        <button onClick={closeAccountModal} className="btn btn-ghost btn-sm" disabled={validating}>
                            <X size={18}/>
                        </button>
                    </div>

                    <div className="p-6">
                        {accountModalError ? (
                            <div role="alert" className="alert alert-error mb-4">
                                <span className="flex-1">{accountModalError}</span>
                                <button className="btn btn-ghost btn-xs" onClick={() => setAccountModalError("")}>
                                    <X size={14}/>
                                </button>
                            </div>
                        ) : null}

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div>
                                <label className="label label-text text-xs">{t("accounts.siteName")}</label>
                                <input
                                    className="input input-bordered input-sm w-full"
                                    placeholder={t("accounts.siteNamePlaceholder")}
                                    value={accountForm.siteName}
                                    onChange={(e) => setAccountForm((f) => ({...f, siteName: e.target.value}))}
                                />
                            </div>
                            <div>
                                <label className="label label-text text-xs">{t("accounts.siteType")}</label>
                                <select
                                    className="select select-bordered select-sm w-full"
                                    value={accountForm.siteType}
                                    onChange={(e) => setAccountForm((f) => ({...f, siteType: e.target.value}))}
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
                            <div>
                                <label className="label label-text text-xs">{t("accounts.siteUrl")}</label>
                                <input
                                    className="input input-bordered input-sm w-full"
                                    placeholder={t("accounts.siteUrlPlaceholder")}
                                    value={accountForm.siteUrl}
                                    onChange={(e) => setAccountForm((f) => ({...f, siteUrl: e.target.value}))}
                                />
                            </div>
                            <div>
                                <label className="label label-text text-xs">{t("accounts.apiKeyInput")}</label>
                                <input
                                    className="input input-bordered input-sm w-full font-mono"
                                    placeholder={t("accounts.apiKeyPlaceholder")}
                                    value={accountForm.apiKey}
                                    onChange={(e) => setAccountForm((f) => ({...f, apiKey: e.target.value}))}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-4">
                            <button className="btn btn-ghost btn-sm" onClick={closeAccountModal} disabled={validating}>
                                {t("common.cancel")}
                            </button>
                            <button className="btn btn-success btn-sm" onClick={handleSubmitAccountModal}
                                    disabled={validating}>
                                {validating ? t("accounts.validating") : t("common.save")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {clearAllConfirmOpen && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                onClick={() => {
                    if (!clearingAll) closeClearAllConfirm();
                }}
                role="dialog"
                aria-modal="true"
                aria-label={t("accounts.clearAllConfirmTitle")}
            >
                <div
                    className="bg-base-100 rounded-2xl shadow-2xl border border-base-300 w-full max-w-md overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div
                        className="px-6 py-4 border-b border-base-200 flex items-center justify-between bg-base-200/30">
                        <h3 className="font-bold">{t("accounts.clearAllConfirmTitle")}</h3>
                        <button onClick={closeClearAllConfirm} className="btn btn-ghost btn-sm" disabled={clearingAll}>
                            <X size={18}/>
                        </button>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-base-content/70">{t("accounts.clearAllConfirmMessage")}</p>
                        <div className="flex justify-end gap-2 mt-6">
                            <button className="btn btn-ghost btn-sm" onClick={closeClearAllConfirm}
                                    disabled={clearingAll}>
                                {t("common.cancel")}
                            </button>
                            <button className="btn btn-error btn-sm" onClick={confirmClearAllAccounts}
                                    disabled={clearingAll}>
                                {t("accounts.clearAll")}
                            </button>
                        </div>
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
              <div className="p-3 border-b border-base-200 flex flex-wrap gap-2 items-end">
                  <div className="form-control">
                      <label className="label label-text text-xs">{t("accounts.filterSite")}</label>
                      <input
                          className="input input-bordered input-sm w-64"
                          value={siteFilter}
                          onChange={(e) => setSiteFilter(e.target.value)}
                          placeholder={t("accounts.filterSitePlaceholder")}
                      />
                  </div>

                  <div className="form-control">
                      <label className="label label-text text-xs">{t("accounts.filterType")}</label>
                      <select
                          className="select select-bordered select-sm w-40"
                          value={typeFilter}
                          onChange={(e) => setTypeFilter(e.target.value)}
                      >
                          <option value="all">{t("accounts.filterAll")}</option>
                          {typeOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                  {opt}
                              </option>
                          ))}
                      </select>
                  </div>

                  <div className="form-control">
                      <label className="label label-text text-xs">{t("accounts.filterHealth")}</label>
                      <select
                          className="select select-bordered select-sm w-40"
                          value={healthFilter}
                          onChange={(e) => setHealthFilter(e.target.value)}
                      >
                          <option value="all">{t("accounts.filterAll")}</option>
                          <option value="unknown">{t("accounts.filterUnknown")}</option>
                          {healthOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                  {opt}
                              </option>
                          ))}
                      </select>
                  </div>

                  <div className="form-control">
                      <label className="label label-text text-xs">{t("accounts.filterStatus")}</label>
                      <select
                          className="select select-bordered select-sm w-40"
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                      >
                          <option value="all">{t("accounts.filterAll")}</option>
                          <option value="enabled">{t("common.enabled")}</option>
                          <option value="disabled">{t("common.disabled")}</option>
                      </select>
                  </div>

                  <div className="flex-1"/>

                  <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                          setSiteFilter("");
                          setTypeFilter("all");
                          setHealthFilter("all");
                          setStatusFilter("all");
                          setSortKey("site");
                          setSortDir("asc");
                      }}
                  >
                      {t("accounts.clearFilters")}
                  </button>
              </div>

            <table className="table table-sm">
              <thead>
                <tr>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("site")}>
                            {t("accounts.site")}
                            {sortKey === "site" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("type")}>
                            {t("accounts.type")}
                            {sortKey === "type" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>

                  <th>{t("accounts.apiKey")}</th>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("quota")}>
                            {t("accounts.quota")}
                            {sortKey === "quota" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("health")}>
                            {t("accounts.health")}
                            {sortKey === "health" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("priority")}>
                            {t("accounts.priority")}
                            {sortKey === "priority" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("weight")}>
                            {t("accounts.weight")}
                            {sortKey === "weight" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>
                    <th>
                        <button className="btn btn-ghost btn-xs" onClick={() => toggleSort("status")}>
                            {t("accounts.status")}
                            {sortKey === "status" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </button>
                    </th>
                  <th>{t("accounts.action")}</th>
                </tr>
              </thead>
              <tbody>
              {filteredSortedAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="font-medium">{account.site_name}</div>
                        <button
                            className="text-xs text-base-content/50 flex items-center gap-1 cursor-pointer hover:opacity-70"
                            onClick={() => copySiteUrl(account)}
                            title="Click to copy site URL"
                            type="button"
                        >
                            <Globe size={12} className="opacity-50"/>
                            <span>{account.site_url}</span>
                            <Copy size={10} className="opacity-40"/>
                        </button>
                    </td>
                    <td>
                      <span className="badge badge-outline badge-sm whitespace-nowrap">
                        {account.site_type}
                      </span>
                    </td>

                    <td>
                        <div className="flex items-center gap-1">
                            {editingApiKeyId === account.id ? (
                                <div className="flex items-center gap-1">
                                    <Key size={12} className="text-success"/>
                                    <input
                                        ref={apiKeyInputRef}
                                        className="input input-bordered input-xs w-56 font-mono"
                                        value={editingApiKeyValue}
                                        onChange={(e) => setEditingApiKeyValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                void saveEditedApiKey(account.id);
                                            }
                                            if (e.key === "Escape") {
                                                cancelEditApiKey();
                                            }
                                        }}
                                        disabled={savingApiKey}
                                    />
                                    <button
                                        className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                                        onClick={() => saveEditedApiKey(account.id)}
                                        disabled={savingApiKey}
                                        title={t("common.save")}
                                        type="button"
                                    >
                                        <span className="text-success font-bold">✓</span>
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                                        onClick={cancelEditApiKey}
                                        disabled={savingApiKey}
                                        title={t("common.cancel")}
                                        type="button"
                                    >
                                        <X size={14} className="opacity-60 hover:opacity-100"/>
                                    </button>
                                </div>
                            ) : account.account_info.api_key ? (
                                <div className="flex items-center gap-1">
                                    <button
                                        className="font-mono text-xs text-success flex items-center gap-1 cursor-pointer hover:opacity-70"
                                        onClick={() => copyApiKey(account)}
                                        title="Click to copy full API key"
                                        type="button"
                                    >
                              <Key size={12} />
                                        {account.account_info.api_key.length > 12
                                            ? `${account.account_info.api_key.slice(0, 8)}...${account.account_info.api_key.slice(-4)}`
                                            : account.account_info.api_key}
                              <Copy size={10} className="opacity-40" />
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                                        onClick={() => startEditApiKey(account)}
                                        title={t("accounts.edit")}
                                        type="button"
                                    >
                                        <Pencil size={14} className="opacity-60 hover:opacity-100"/>
                                    </button>
                                </div>
                            ) : (
                          <span className="text-xs text-base-content/40">
                            {account.site_type === "sub2api" ? t("accounts.jwt") : t("accounts.notFetched")}
                          </span>
                            )}
                        </div>
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
                          className={`badge badge-sm cursor-pointer hover:opacity-80 ${
                          account.disabled ? "badge-error" : "badge-success"
                        }`}
                          onClick={() => toggleAccount(account)}
                          title={t("accounts.toggleStatus")}
                      >
                        {account.disabled ? t("common.disabled") : t("common.enabled")}
                      </span>
                    </td>
                    <td>
                        <div className="flex gap-1">
                            <button
                                className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                                onClick={() => openEditAccountModal(account)}
                                title={t("accounts.edit")}
                            >
                                <Pencil size={14} className="opacity-60 hover:opacity-100"/>
                            </button>
                            <button
                                className="btn btn-ghost btn-xs p-0 min-h-0 h-auto"
                                onClick={() => openDuplicateAccountModal(account)}
                                title={t("accounts.duplicate")}
                            >
                                <Copy size={14} className="opacity-60 hover:opacity-100"/>
                            </button>
                            <button
                                className="btn btn-ghost btn-xs p-0 min-h-0 h-auto text-error"
                                onClick={() => handleDeleteAccount(account)}
                                title={t("accounts.delete")}
                            >
                                <Trash2 size={14} className="opacity-60 hover:opacity-100"/>
                            </button>
                        </div>
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
