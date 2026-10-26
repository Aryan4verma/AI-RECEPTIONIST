import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { adminApi, type LocalModel, type Provider } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeading, Toast, Card, CardHead, LoadingState } from "../../components/ui";
import { IconChip } from "../../components/icons";
import { formatBytes } from "../../lib/format";

export default function Models() {
  const { user } = useAdminAuth();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [localModels, setLocalModels] = useState<LocalModel[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftModel, setDraftModel] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error" | "info"; msg: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Provider | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
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
      if (!r.ollama.reachable) { setLocalModels(null); setLocalError("Ollama isn’t reachable. Start the local service, then refresh."); return; }
      setLocalModels(r.ollama.models);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setLocalModels(null);
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
    } catch (e) {
      setToast({ tone: "error", msg: e instanceof ApiError ? e.message : "Couldn't test this provider." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: Provider) {
    if (!user) return;
    setBusyId(p.id);
    try {
      await adminApi.deleteProvider(user.token, p.id);
      setRemoveTarget(null);
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
        sub="Choose the intelligence behind your front desk. Local first, with deliberate control."
        actions={<Button onClick={() => { setDraftModel(""); setAdding(true); }}>Add provider</Button>}
      />
      {error && <ErrorNote onRetry={refresh}>{error}</ErrorNote>}

      {/* Local models */}
      <section aria-labelledby="local-h" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div><p className="section-kicker mb-2">On this machine</p><h2 id="local-h" className="font-display text-2xl text-ink">Local models</h2></div>
          <Button size="sm" variant="secondary" onClick={refreshLocal}>Refresh</Button>
        </div>
        {localModels === null ? (
          localError ? (
            <ErrorNote onRetry={refreshLocal}>{localError}</ErrorNote>
          ) : (
            <LoadingState label="Discovering local models" />
          )
        ) : localModels.length === 0 ? (
          <EmptyState title="No local models found" body="Install models with Ollama, then refresh." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {localModels.map((m) => {
              const owner = providers?.find((p) => p.kind === "local" && p.modelId === m.name);
              const active = owner?.isActive === true;
              return (
                <li key={m.name} className={`min-w-0 rounded-card border bg-surface p-5 shadow-card ${active ? "border-pine-400 ring-1 ring-pine-400/30" : "border-line"}`}>
                  <div className="mb-5 flex items-center gap-2 text-xs font-medium text-pine-700"><IconChip className="size-4" /> Ollama <span className="ml-auto text-ink-3">Installed</span></div>
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
                    loading={!!owner && busyId === owner.id}
                    onClick={() => { if (owner) void activate(owner, m.name); else { setDraftModel(m.name); setAdding(true); } }}
                  >
                    {active ? "In use" : owner ? "Activate" : "Configure this model"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mb-9 grid gap-4 border-y border-line py-5 sm:grid-cols-2"><div><p className="text-xs font-semibold text-ink">Installation is not a memory guarantee</p><p className="mt-1.5 text-xs leading-relaxed text-ink-3">Speech recognition checks available RAM before starting. Local speech and model inference run sequentially.</p></div><div><p className="text-xs font-semibold text-ink">Cloud inference is opt-in</p><p className="mt-1.5 text-xs leading-relaxed text-ink-3">Configuring a provider doesn’t authorize cloud inference. Owner approval is a separate step.</p></div></div>

      {/* Providers */}
      <section aria-labelledby="prov-h">
        <p className="section-kicker mb-2">Runtime configuration</p><h2 id="prov-h" className="mb-4 font-display text-2xl text-ink">Your providers</h2>
        {providers === null ? (
          !error && <LoadingState label="Loading providers" />
        ) : providers.length === 0 ? (
          <Card className="flex items-start gap-4 p-6"><span className="record-avatar"><IconChip className="size-5" /></span><div className="min-w-0"><h3 className="font-display text-xl tracking-tight">Using the server’s local default</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-3">No provider has been explicitly selected. Configure an installed local model to choose it here.</p></div></Card>
        ) : (
          <ul className="collection divide-y divide-line">
            {providers.map((p) => (
              <li key={p.id} className="record-row">
                <div className="min-w-0 flex-1">
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
                  <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(p)} aria-label={`Remove ${p.displayName}`}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} dismissible={busyId !== removeTarget?.id} title="Remove this provider?" footer={<><Button variant="secondary" disabled={busyId === removeTarget?.id} onClick={() => setRemoveTarget(null)}>Keep provider</Button><Button variant="danger" loading={busyId === removeTarget?.id} onClick={() => removeTarget && void remove(removeTarget)}>Remove provider</Button></>}><p>The provider configuration and its stored credential will be removed. Your conversations and appointments are kept.</p></Modal>

      <AddProviderModal
        open={adding}
        onClose={() => setAdding(false)}
        onDone={async (msg) => {
          setToast(msg);
          await refresh();
          await refreshLocal();
        }}
        token={user?.token ?? ""}
        initialModel={draftModel}
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
  initialModel,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (toast: { tone: "success" | "error" | "info"; msg: string }) => void;
  token: string;
  initialModel: string;
}) {
  const [kind, setKind] = useState<"local" | "cloud">("local");
  const [displayName, setDisplayName] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setKind("local"); setModelId(initialModel); setDisplayName(initialModel ? "Local Ollama" : "");
    setBaseUrl(""); setApiKey(""); setError(null);
  }, [open, initialModel]);

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
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-prov" loading={busy}>Add</Button>
        </>
      }
    >
      <form id="add-prov" onSubmit={submit} className="space-y-5">
        <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-[13px] font-semibold">Provider location</legend>
          {(["local", "cloud"] as const).map((k) => (
            <label
              key={k}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-3 text-sm font-medium transition-colors ${
                kind === k ? "border-pine-600 bg-pine-50 text-pine-700" : "border-line-strong bg-surface text-ink-2"
              }`}
            >
              <input type="radio" name="provider-kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1 accent-pine-700" />
              <span>{k === "local" ? "Local Ollama" : "Optional cloud"}<small className="mt-1 block text-xs font-normal leading-relaxed text-ink-3">{k === "local" ? "Runs on this machine" : "OpenAI-compatible endpoint"}</small></span>
            </label>
          ))}
        </fieldset>
        <Field label="Display name" htmlFor="p-name">
          <Input id="p-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={kind === "local" ? "Front desk model" : "OpenAI"} />
        </Field>
        <Field label="Model identifier" htmlFor="p-model" hint={kind === "local" ? "For example, qwen3:1.7b. It must be installed locally." : "Use the exact model identifier supplied by your provider."}>
          <Input id="p-model" required value={modelId} onChange={(e) => setModelId(e.target.value)} className="font-mono" />
        </Field>
        {kind === "cloud" && (
          <>
            <Field label="API base URL" htmlFor="p-url" hint="Public https endpoint only.">
              <Input id="p-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="font-mono" />
            </Field>
            <Field label="API key" htmlFor="p-key" hint="Write-only: stored securely and never returned to this screen.">
              <Input id="p-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </Field>
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-fg">
              Configuring a provider does not enable cloud inference. Activation requires the business owner’s separate authorization.
            </p>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
