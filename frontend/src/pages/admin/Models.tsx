import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type LocalModel, type Provider } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeading, Spinner, Toast } from "../../components/ui";
import { formatBytes } from "../../lib/format";

export default function Models() {
  const { user } = useAdminAuth();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error" | "info"; msg: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await adminApi.providers(user.token);
      setProviders(r.providers);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load providers.");
    }
  }, [user]);

  const refreshLocal = useCallback(async () => {
    if (!user) return;
    setLocalError(null);
    try {
      const r = await adminApi.localModels(user.token);
      setLocalModels(r.ollama.models);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setLocalError(code === "OLLAMA_UNAVAILABLE" ? "Ollama isn't reachable on this machine." : "Failed to discover local models.");
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    void refreshLocal();
  }, [refresh, refreshLocal]);

  async function activate(p: Provider, modelId?: string) {
    if (!user) return;
    setBusyId(p.id);
    try {
      const r = await adminApi.setActiveModel(user.token, p.id, modelId);
      setToast({ tone: "success", msg: `Active model: ${r.modelId} — applies on the next message` });
      await refresh();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setToast({
        tone: "error",
        msg:
          code === "MODEL_UNAVAILABLE"
            ? "That model isn't installed on the local provider."
            : e instanceof ApiError
              ? e.message
              : "Couldn't switch the active model.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function test(p: Provider) {
    if (!user) return;
    setBusyId(p.id);
    try {
      const r = await adminApi.testProvider(user.token, p.id);
      setToast({
        tone: r.status === "ok" ? "success" : "error",
        msg: r.status === "ok" ? `Connection OK (${r.latencyMs} ms)` : `Connection failed: ${r.detail ?? "unreachable"}`,
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: Provider) {
    if (!user) return;
    setBusyId(p.id);
    try {
      await adminApi.deleteProvider(user.token, p.id);
      setToast({ tone: "info", msg: "Provider removed" });
      await refresh();
    } catch (e) {
      setToast({ tone: "error", msg: e instanceof ApiError ? e.message : "Couldn't remove the provider." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeading
        title="AI models"
        sub="Local models are always available. Cloud providers can be configured, but cloud inference stays off until separately authorized."
        actions={<Button onClick={() => setAdding(true)}>Add provider</Button>}
      />
      {error && <ErrorNote onRetry={refresh}>{error}</ErrorNote>}

      {/* Local models */}
      <section aria-labelledby="local-h" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="local-h" className="font-display text-lg text-ink">Installed local models (Ollama)</h2>
          <Button size="sm" variant="secondary" onClick={refreshLocal}>Refresh</Button>
        </div>
        {localModels === null ? (
          localError ? (
            <ErrorNote>{localError}</ErrorNote>
          ) : (
            <div className="flex justify-center py-10 text-ink-3"><Spinner /></div>
          )
        ) : localModels.length === 0 ? (
          <EmptyState title="No local models found" body="Install models with Ollama, then refresh." />
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {localModels.map((m) => {
              const owner = providers?.find((p) => p.kind === "local" && p.modelId === m.name);
              const active = owner?.isActive === true;
              return (
                <li key={m.name} className={`rounded-card border bg-surface p-4 ${active ? "border-pine-400 ring-1 ring-pine-400/40" : "border-line"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[13px] font-semibold text-ink">{m.name}</p>
                      <p className="mt-0.5 text-xs text-ink-3">
                        {[m.parameterSize, formatBytes(m.sizeBytes)].filter(Boolean).join(" · ") || "local"}
                      </p>
                    </div>
                    {active && <Badge tone="success">Active</Badge>}
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    variant={active ? "secondary" : "primary"}
                    disabled={active}
                    loading={busyId === owner?.id}
                    onClick={() => (owner ? activate(owner, m.name) : setToast({ tone: "info", msg: "Add this as a local provider first, then activate it." }))}
                  >
                    {active ? "In use" : owner ? "Activate" : "Add as provider to activate"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Providers */}
      <section aria-labelledby="prov-h">
        <h2 id="prov-h" className="mb-3 font-display text-lg text-ink">Configured providers</h2>
        {providers === null ? (
          <div className="flex justify-center py-10 text-ink-3"><Spinner /></div>
        ) : providers.length === 0 ? (
          <EmptyState title="No providers configured" body="Add the local Ollama provider (any installed model) or a cloud provider." />
        ) : (
          <ul className="space-y-2.5">
            {providers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{p.displayName}</p>
                    <Badge tone={p.kind === "cloud" ? "info" : "neutral"}>{p.kind}</Badge>
                    {p.isActive && <Badge tone="success">Active</Badge>}
                    {p.status === "error" && <Badge tone="danger">Error</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-ink-3">
                    {[p.modelId, p.baseUrl].filter(Boolean).join(" @ ") || "no model set"}
                    {p.hasCredential ? " · key stored" : p.kind === "cloud" ? " · no key" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {p.kind === "cloud" && !p.isActive && (
                    <span className="micro" title="Cloud inference requires separate owner authorization">
                      needs authorization
                    </span>
                  )}
                  {!p.isActive && (
                    <Button size="sm" loading={busyId === p.id} disabled={!p.modelId} onClick={() => activate(p)}>
                      Activate
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" loading={busyId === p.id} onClick={() => test(p)}>
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(p)} aria-label={`Remove ${p.displayName}`}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddProviderModal
        open={adding}
        onClose={() => setAdding(false)}
        onDone={async (msg) => {
          setToast(msg);
          await refresh();
          await refreshLocal();
        }}
        token={user?.token ?? ""}
      />
      {toast && <Toast tone={toast.tone} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

function AddProviderModal({
  open,
  onClose,
  onDone,
  token,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (toast: { tone: "success" | "error" | "info"; msg: string }) => void;
  token: string;
}) {
  const [kind, setKind] = useState<"local" | "cloud">("local");
  const [displayName, setDisplayName] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        kind,
        adapter: kind === "local" ? "ollama" : "openai_compatible",
        displayName: displayName.trim(),
        modelId: modelId.trim() || undefined,
        ...(kind === "cloud" ? { baseUrl: baseUrl.trim() } : {}),
        ...(kind === "cloud" && apiKey ? { credential: apiKey } : {}),
      };
      const p = await adminApi.createProvider(token, body);
      onDone({
        tone: "success",
        msg: `${p.displayName} added${p.hasCredential ? " (key stored)" : ""}${p.kind === "cloud" ? " — activation requires authorization" : ""}`,
      });
      onClose();
      setDisplayName(""); setModelId(""); setBaseUrl(""); setApiKey("");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "UNSAFE_ENDPOINT") setError("That endpoint isn't allowed (must be a public https address).");
        else if (err.code === "CREDENTIAL_STORE_UNAVAILABLE")
          setError("Secure credential storage isn't available on this deployment — add the provider without a key or contact the owner.");
        else setError(err.message);
      } else {
        setError("Couldn't add the provider.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add provider"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-prov" loading={busy}>Add</Button>
        </>
      }
    >
      <form id="add-prov" onSubmit={submit} className="space-y-3.5">
        <div className="flex gap-2" role="radiogroup" aria-label="Provider kind">
          {(["local", "cloud"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                kind === k ? "border-pine-600 bg-pine-50 text-pine-700" : "border-line-strong bg-surface text-ink-2"
              }`}
            >
              {k === "local" ? "Local (Ollama)" : "Cloud (OpenAI-compatible)"}
            </button>
          ))}
        </div>
        <Field label="Display name" htmlFor="p-name">
          <Input id="p-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={kind === "local" ? "Front desk model" : "OpenAI"} />
        </Field>
        <Field label="Model identifier" htmlFor="p-model" hint={kind === "local" ? "e.g. qwen3:1.7b — must be installed locally." : "e.g. gpt-4o-mini"}>
          <Input id="p-model" required value={modelId} onChange={(e) => setModelId(e.target.value)} className="font-mono" />
        </Field>
        {kind === "cloud" && (
          <>
            <Field label="API base URL" htmlFor="p-url" hint="Public https endpoint only.">
              <Input id="p-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="font-mono" />
            </Field>
            <Field label="API key" htmlFor="p-key" hint="Stored securely; shown only as •••• afterwards.">
              <Input id="p-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </Field>
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-fg">
              Cloud inference stays off until the business owner separately authorizes it. Configuring now is safe.
            </p>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
