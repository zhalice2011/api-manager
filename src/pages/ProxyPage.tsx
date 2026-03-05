import {useEffect, useState} from "react";
import {request} from "../utils/request";
import type {AppConfig} from "../types/backup";
import {Copy, Play, Save, Square} from "lucide-react";
import CliSyncCard from "../components/CliSyncCard";
import PageSkeleton from "../components/PageSkeleton";
import {useConfig} from "../hooks/useConfig";
import {useLocale} from "../hooks/useLocale";

interface ProxyStatus {
  running: boolean;
}

export default function ProxyPage() {
  const { config, setConfig, error, setError, save } = useConfig();
  const [status, setStatus] = useState<ProxyStatus>({ running: false });
  const [loading, setLoading] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const { t } = useLocale();

  // Load proxy status once config is available
  if (config && !statusLoaded) {
    setStatusLoaded(true);
    request<ProxyStatus>("get_proxy_status")
      .then(setStatus)
      .catch(() => {});
  }

  async function handleStart() {
    if (!config) return;
    setLoading(true);
    setError("");
    try {
      await request("proxy_start", { config_data: config });
      setStatus({ running: true });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    setError("");
    try {
      await request("proxy_stop");
      setStatus({ running: false });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConfig() {
    if (!config) return;
    if (loading) return;
    setSaveStatus("");
    try {
      await save(config);
      setSaveStatus(t("proxy.saved"));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (!saveStatus) return;
    const timer = setTimeout(() => setSaveStatus(""), 3000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  if (!config) {
    return <PageSkeleton />;
  }

  const activeAccounts = config.proxy_accounts.filter((a) => !a.disabled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("proxy.title")}</h1>
          <p className="text-base-content/60 text-sm">
            {t("proxy.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-base-content/50">
            {activeAccounts} {t("proxy.activeAccounts")}
          </span>
          <span
            className={`badge badge-sm ${status.running ? "badge-success" : "badge-error"}`}
          >
            {status.running ? t("common.running") : t("common.stopped")}
          </span>
          {status.running ? (
            <button
              className="btn btn-error btn-sm btn-outline gap-1.5"
              onClick={handleStop}
              disabled={loading}
            >
              <Square size={14} />
              {t("proxy.stopProxy")}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm gap-1.5"
              onClick={handleStart}
              disabled={loading || activeAccounts === 0}
            >
              <Play size={14} />
              {t("proxy.startProxy")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {saveStatus && (
          <div role="status" className="alert alert-success">
            <span>{saveStatus}</span>
          </div>
      )}

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3">
          <h2 className="card-title text-sm font-medium text-base-content/60">
            {t("proxy.configuration")}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="form-control">
              <span className="label-text text-xs mb-1">{t("proxy.port")}</span>
              <input
                className="input input-bordered input-sm"
                type="number"
                value={config.proxy.port}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    proxy: { ...config.proxy, port: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs mb-1">{t("proxy.apiKey")}</span>
              <input
                className="input input-bordered input-sm font-mono"
                type="text"
                value={config.proxy.api_key}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    proxy: { ...config.proxy, api_key: e.target.value },
                  })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs mb-1">{t("proxy.authMode")}</span>
              <select
                className="select select-bordered select-sm"
                value={config.proxy.auth_mode}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    proxy: {
                      ...config.proxy,
                      auth_mode: e.target.value as AppConfig["proxy"]["auth_mode"],
                    },
                  })
                }
              >
                <option value="auto">{t("proxy.authAuto")}</option>
                <option value="off">{t("proxy.authOff")}</option>
                <option value="strict">{t("proxy.authStrict")}</option>
                <option value="all_except_health">{t("proxy.authAllExceptHealth")}</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs mb-1">{t("proxy.loadBalanceMode")}</span>
              <select
                className="select select-bordered select-sm"
                value={config.proxy.load_balance_mode ?? "round_robin"}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    proxy: {
                      ...config.proxy,
                      load_balance_mode: e.target.value as AppConfig["proxy"]["load_balance_mode"],
                    },
                  })
                }
              >
                <option value="round_robin">{t("proxy.roundRobin")}</option>
                <option value="failover">{t("proxy.failover")}</option>
                <option value="random">{t("proxy.random")}</option>
                <option value="weighted">{t("proxy.weighted")}</option>
              </select>
            </label>
          </div>

          <div className="flex justify-end">
            <button className="btn btn-primary btn-sm gap-2" onClick={handleSaveConfig}>
              <Save size={14} />
              {t("proxy.saveConfig")}
            </button>
          </div>
        </div>
      </div>

      {status.running && (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-sm font-medium text-base-content/60">
              <Copy size={16} />
              {t("proxy.usageExamples")}
            </h2>
            <div className="code-block">
{`# OpenAI Chat Completions
curl -X POST http://127.0.0.1:${config.proxy.port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.proxy.api_key}" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'

# Streaming
curl -X POST http://127.0.0.1:${config.proxy.port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.proxy.api_key}" \\
  -d '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"hello"}]}'

# Health Check
curl http://127.0.0.1:${config.proxy.port}/health`}
            </div>
          </div>
        </div>
      )}

      {status.running && (
        <CliSyncCard
          proxyUrl={`http://127.0.0.1:${config.proxy.port}`}
          apiKey={config.proxy.api_key}
          proxyPort={config.proxy.port}
        />
      )}
    </div>
  );
}
