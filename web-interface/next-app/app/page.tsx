"use client";

import { FormEvent, useEffect, useState } from "react";

type JsonObject = Record<string, any>;

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

type PreparedApproval = {
  actionId: string;
  approvalToken: string;
  commandBindingId: string;
  decisionId: string;
  expiresAt: string;
  explanation: string;
  params: JsonObject;
  paramsHash: string;
  status: "prepared" | "committing" | "committed" | "failed";
};

type PlatformTurn = JsonObject & {
  ok?: boolean;
  route?: JsonObject;
  toolResults?: JsonObject[];
  userSummary?: string;
};

type AuditEvent = {
  actionId?: string | null;
  decisionId?: string | null;
  deviceProfile?: string | null;
  evidenceSummary?: JsonObject | null;
  kind: string;
  ok?: boolean | null;
  operation?: string | null;
  paramsHash?: string | null;
  payloadsRedacted?: boolean;
  policy?: JsonObject | null;
  result?: JsonObject | null;
  sessionId?: string | null;
  status?: number | null;
  subjectKind?: string | null;
  timestamp: string;
  toolName?: string | null;
  turnId?: string | null;
};

type AuthSubject = {
  authenticated: boolean;
  bindingSource?: string | null;
  deviceId?: string | null;
  deviceProfile?: string | null;
  kind: string | null;
  orgId?: string | null;
  roles: string[];
  sessionId: string | null;
  userId: string | null;
};

type AuthManagement = {
  bindings?: Array<{ active?: boolean; deviceId?: string; role?: string; userId?: string }>;
  devices?: Array<{ active?: boolean; deviceProfile?: string; id?: string; label?: string; target?: string }>;
  orgs?: Array<{ id?: string; name?: string }>;
};

type ScreenPlaylistView = {
  ok?: boolean;
  playlistHash?: string;
  playlist?: JsonObject;
  items?: JsonObject[];
};

type ScreenRecordSummary = {
  artifactHash?: string | null;
  buildId?: string | null;
  failedStage?: string | null;
  finishedAt?: string | null;
  frameHash?: string | null;
  frameUrl?: string | null;
  hasFramePng?: boolean;
  manifestHash?: string | null;
  ok?: boolean;
  playlistHash?: string | null;
  startedAt?: string | null;
  summary?: string | null;
  title?: string | null;
  visualMatch?: string | null;
  webDeviceFrameDiffStatus?: string | null;
};

type ScreenManifestDetail = {
  manifest?: JsonObject | null;
  manifestHash?: string | null;
  ok?: boolean;
};

type ScreenRecordDetail = {
  framePng?: { url?: string | null } | null;
  buildId?: string | null;
  manifestHash?: string | null;
  playlistHash?: string | null;
  visualMatch?: string | null;
  webDeviceFrameDiff?: JsonObject | null;
};

type ScreenLvglPreview = {
  frames?: Array<{ png?: string; ms?: number }>;
  playlistHash?: string | null;
};

type SidePanelTab = "status" | "screen" | "advanced";

const QUICK_CAPABILITIES = [
  { label: "Device status", capability: "device.status.read", text: "device.status.read" },
  { label: "Screen playlist", capability: "screen.readPlaylist", text: "screen.readPlaylist" },
  { label: "Curated eval", capability: "eval.curated.list", text: "eval.curated.list" },
  { label: "Prepare restart", capability: "policy.action.prepare", text: "prepare restart_walnut_screen_service", actionId: "restart_walnut_screen_service", params: {} },
];

const DEVICE_DIAGNOSTIC_CAPABILITIES = [
  { label: "Network", capability: "device.network.read", text: "device.network.read" },
  { label: "Snapshot", capability: "device.snapshot.read", text: "device.snapshot.read" },
  { label: "GPIO", capability: "device.gpio.read", text: "device.gpio.read" },
  { label: "I2C", capability: "device.i2c.read", text: "device.i2c.read" },
  { label: "Notes", capability: "device.notes.read", text: "device.notes.read" },
  { label: "Recent failure", capability: "diagnostics.recentFailure", text: "diagnostics.recentFailure" },
];

export default function WalnutConsolePage() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: cryptoId(), role: "system", text: "Next.js console is attached to the Mastra/MCP platform path." },
  ]);
  const [lastTurn, setLastTurn] = useState<PlatformTurn | null>(null);
  const [approvals, setApprovals] = useState<PreparedApproval[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [authSubject, setAuthSubject] = useState<AuthSubject | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authManagement, setAuthManagement] = useState<AuthManagement | null>(null);
  const [bindingDeviceLabel, setBindingDeviceLabel] = useState("Default WalnutPi Device");
  const [bindingTarget, setBindingTarget] = useState("root@192.168.44.126");
  const [bindingRole, setBindingRole] = useState("owner");
  const [authNotice, setAuthNotice] = useState("");
  const [screenPlaylist, setScreenPlaylist] = useState<ScreenPlaylistView | null>(null);
  const [screenRecords, setScreenRecords] = useState<ScreenRecordSummary[]>([]);
  const [screenPrompt, setScreenPrompt] = useState("");
  const [screenSourceUrl, setScreenSourceUrl] = useState("");
  const [screenSourceId, setScreenSourceId] = useState("");
  const [screenManifestDetail, setScreenManifestDetail] = useState<ScreenManifestDetail | null>(null);
  const [screenRecordDetail, setScreenRecordDetail] = useState<ScreenRecordDetail | null>(null);
  const [screenPreview, setScreenPreview] = useState<ScreenLvglPreview | null>(null);
  const [screenBusy, setScreenBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>("status");

  const [sessionId, setSessionId] = useState("server");
  const latestTool = lastTurn?.toolResults?.at(-1) || null;

  useEffect(() => {
    setSessionId(getSessionId());
    refreshAuthSubject();
    refreshAuthManagement();
    refreshAuditEvents();
    refreshScreenWorkspace();
  }, []);

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    addMessage("user", text);
    await runNaturalTurn(text);
  }

  async function runNaturalTurn(text: string) {
    setBusy(true);
    setError("");
    try {
      const turn = await postTurn({ text, sessionId });
      acceptTurn(turn);
      await refreshAuthSubject();
      await refreshAuthManagement();
      await refreshAuditEvents();
    } catch (caught: any) {
      setError(caught.message);
      addMessage("assistant", caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function runCapability(input: JsonObject) {
    setBusy(true);
    setError("");
    addMessage("user", input.text || input.capability);
    try {
      const turn = await postTurn({ sessionId, ...input });
      acceptTurn(turn);
      await refreshAuthSubject();
      await refreshAuthManagement();
      await refreshAuditEvents();
      if (String(input.capability || "").startsWith("screen.")) {
        await refreshScreenWorkspace();
      }
    } catch (caught: any) {
      setError(caught.message);
      addMessage("assistant", caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function commitApproval(approval: PreparedApproval) {
    setApprovals((items) => items.map((item) => item.decisionId === approval.decisionId ? { ...item, status: "committing" } : item));
    setBusy(true);
    setError("");
    try {
      const turn = await postTurn({
        sessionId,
        capability: "policy.action.commit",
        text: `approve ${approval.actionId}`,
        decisionId: approval.decisionId,
        actionId: approval.actionId,
        params: approval.params,
        approvalToken: approval.approvalToken,
        execute: true,
      });
      acceptTurn(turn);
      const ok = Boolean(turn.toolResults?.at(-1)?.ok);
      setApprovals((items) => items.map((item) => item.decisionId === approval.decisionId ? { ...item, status: ok ? "committed" : "failed" } : item));
      await refreshAuthSubject();
      await refreshAuthManagement();
      await refreshAuditEvents();
    } catch (caught: any) {
      setError(caught.message);
      addMessage("assistant", caught.message);
      setApprovals((items) => items.map((item) => item.decisionId === approval.decisionId ? { ...item, status: "failed" } : item));
    } finally {
      setBusy(false);
    }
  }

  function acceptTurn(turn: PlatformTurn) {
    setLastTurn(turn);
    addMessage("assistant", platformTurnText(turn) || "Completed.");
    const approval = approvalFromTurn(turn);
    if (approval) {
      setApprovals((items) => [approval, ...items.filter((item) => item.decisionId !== approval.decisionId)]);
    }
  }

  function addMessage(role: Message["role"], text: string) {
    setMessages((items) => [...items, { id: cryptoId(), role, text }]);
  }

  async function refreshAuditEvents() {
    try {
      const response = await fetch("/api/gateway/audit-events?limit=12", { cache: "no-store" });
      const data = await response.json();
      setAuditEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setAuditEvents([]);
    }
  }

  async function refreshAuthSubject() {
    try {
      const response = await fetch("/api/auth/subject", { cache: "no-store" });
      const data = await response.json();
      setAuthSubject(data.subject || null);
    } catch {
      setAuthSubject(null);
    }
  }

  async function refreshAuthManagement() {
    try {
      const response = await fetch("/api/auth/bindings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        setAuthManagement(null);
        return;
      }
      setAuthManagement(data);
      const defaultDevice = Array.isArray(data.devices) ? data.devices[0] : null;
      const defaultBinding = Array.isArray(data.bindings) ? data.bindings[0] : null;
      if (defaultDevice?.label) setBindingDeviceLabel(String(defaultDevice.label));
      if (defaultDevice?.target) setBindingTarget(String(defaultDevice.target));
      if (defaultBinding?.role) setBindingRole(String(defaultBinding.role));
    } catch {
      setAuthManagement(null);
    }
  }

  async function refreshScreenWorkspace() {
    setScreenBusy(true);
    try {
      const [playlistResponse, recordsResponse] = await Promise.all([
        fetch("/api/screen/workspace/playlist", { cache: "no-store" }),
        fetch("/api/screen/records", { cache: "no-store" }),
      ]);
      const playlistData = await playlistResponse.json().catch(() => ({}));
      const recordsData = await recordsResponse.json().catch(() => ({}));
      setScreenPlaylist(playlistData?.ok ? playlistData : null);
      setScreenRecords(Array.isArray(recordsData.records) ? recordsData.records : []);
    } catch {
      setScreenPlaylist(null);
      setScreenRecords([]);
    } finally {
      setScreenBusy(false);
    }
  }

  async function generateScreenWorkspace() {
    const prompt = screenPrompt.trim();
    if (!prompt) return;
    setScreenBusy(true);
    setError("");
    try {
      const data = await postJson("/api/screen/workspace/generate", {
        prompt,
        outputType: "static",
        playlist: "default",
        preset: "fit-cover:480x320",
        sessionId,
      });
      await refreshScreenWorkspace();
      if (data.screenId) await loadManifestDetail(data.screenId);
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setScreenBusy(false);
    }
  }

  async function importScreenSource() {
    const url = screenSourceUrl.trim();
    if (!url) return;
    setScreenBusy(true);
    setError("");
    try {
      const data = await postJson("/api/screen/workspace/import", {
        url,
        sourceId: screenSourceId.trim() || undefined,
        license: "unknown-personal-sync",
      });
      setScreenSourceId(data.sourceAssetId || data.source?.id || screenSourceId);
      await refreshScreenWorkspace();
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setScreenBusy(false);
    }
  }

  async function processImportedSource() {
    const sourceAssetId = screenSourceId.trim();
    if (!sourceAssetId) return;
    setScreenBusy(true);
    setError("");
    try {
      const screenId = `next-${Date.now()}`;
      const data = await postJson("/api/screen/workspace/process", {
        sourceAssetId,
        screenId,
        outputType: "static",
        playlist: "default",
        playlistMode: "replace",
        preset: "fit-cover:480x320",
      });
      await refreshScreenWorkspace();
      await loadManifestDetail(data.screenId || screenId);
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setScreenBusy(false);
    }
  }

  async function renderLvglPreview() {
    setScreenBusy(true);
    setError("");
    try {
      const data = await postJson("/api/screen/workspace/lvgl-preview", {});
      setScreenPreview(data);
    } catch (caught: any) {
      setError(caught.message);
    } finally {
      setScreenBusy(false);
    }
  }

  async function loadManifestDetail(manifestId: string) {
    const cleanId = String(manifestId || "").trim();
    if (!cleanId) return;
    setScreenBusy(true);
    try {
      const response = await fetch(`/api/screen/workspace/manifest/${encodeURIComponent(cleanId)}`, { cache: "no-store" });
      const data = await response.json();
      setScreenManifestDetail(data?.ok ? data : null);
    } catch {
      setScreenManifestDetail(null);
    } finally {
      setScreenBusy(false);
    }
  }

  async function loadRecordDetail(buildId: string) {
    const cleanId = String(buildId || "").trim();
    if (!cleanId) return;
    setScreenBusy(true);
    try {
      const response = await fetch(`/api/screen/records/${encodeURIComponent(cleanId)}`, { cache: "no-store" });
      const data = await response.json();
      setScreenRecordDetail(data?.ok ? data.record : null);
    } catch {
      setScreenRecordDetail(null);
    } finally {
      setScreenBusy(false);
    }
  }

  async function submitAuth(mode: "sign-up" | "sign-in") {
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) {
      setAuthNotice("Email and password are required.");
      return;
    }
    setAuthBusy(true);
    setAuthNotice("");
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: email.split("@")[0] || "Walnut Owner",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || `${mode} failed`);
      }
      setAuthPassword("");
      setAuthNotice(mode === "sign-up" ? "Signed up with a server-issued session." : "Signed in with a server-issued session.");
      await refreshAuthSubject();
      await refreshAuditEvents();
    } catch (caught: any) {
      setAuthNotice(caught.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    setAuthBusy(true);
    setAuthNotice("");
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
      setAuthNotice("Signed out. Local owner profile remains server-derived for development.");
      await refreshAuthSubject();
      await refreshAuthManagement();
    } catch (caught: any) {
      setAuthNotice(caught.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function saveAuthBinding() {
    setAuthBusy(true);
    setAuthNotice("");
    setError("");
    try {
      const data = await postJson("/api/auth/bindings/upsert", {
        org: { id: authSubject?.orgId || "local-control-plane", name: "Local WalnutPi Control Plane" },
        device: {
          id: authSubject?.deviceId || "default-walnutpi",
          label: bindingDeviceLabel,
          deviceProfile: "device",
          target: bindingTarget,
          active: true,
        },
        binding: {
          role: bindingRole,
          active: true,
        },
      });
      setAuthNotice(`Saved server-owned device binding for ${data.device?.target || bindingTarget}.`);
      await refreshAuthSubject();
      await refreshAuthManagement();
    } catch (caught: any) {
      setAuthNotice(caught.message);
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[#0f1111] text-[#ece7db]">
      <div className="grid h-screen min-h-0 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1.12fr)_420px]">
        <section className="flex min-h-0 flex-col overflow-hidden border-r border-[#2a2f2f]">
          <header className="shrink-0 border-b border-[#2a2f2f] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#8a938d]">WalnutPi control plane</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#f4efe2] md:text-4xl">Walnut Agent Console</h1>
              </div>
              <div className="rounded-none border border-[#3a4140] bg-[#151818] px-3 py-2 font-mono text-xs text-[#9eb7b2]">
                session {sessionId.slice(0, 8)} / {authSubject?.kind || "subject unknown"}
              </div>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 p-4 md:p-5">
            <section className="min-h-0 overflow-auto border border-[#2a2f2f] bg-[#121515] p-3">
              <div className="grid gap-3">
                {messages.map((message) => (
                  <article key={message.id} className={`max-w-[88%] ${message.role === "user" ? "justify-self-end" : "justify-self-start"}`}>
                    <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[#77807b]">{message.role}</div>
                    <div className={`whitespace-pre-wrap border px-3 py-2 text-sm leading-6 ${message.role === "user" ? "border-[#5b8e89] bg-[#19302e]" : "border-[#283030] bg-[#171b1b]"}`}>
                      {message.text}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="grid gap-3 border border-[#2a2f2f] bg-[#141717] p-3">
              <div className="flex flex-wrap gap-2">
                {QUICK_CAPABILITIES.map((item) => (
                  <button
                    key={item.label}
                    className="border border-[#35403f] bg-[#101313] px-3 py-2 text-sm text-[#d7d2c6] hover:border-[#7fbdb6] disabled:opacity-50"
                    disabled={busy}
                    type="button"
                    onClick={() => runCapability(item)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <form className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitPrompt}>
                <textarea
                  className="h-24 resize-none border border-[#35403f] bg-[#0e1111] px-3 py-3 text-sm leading-6 text-[#f4efe2]"
                  disabled={busy}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask for device status, screen work, memory capture, or a policy prepare flow."
                  value={prompt}
                />
                <button className="border border-[#78c8bd] bg-[#173230] px-5 py-3 text-sm font-semibold text-[#eafffb] hover:bg-[#1e403d] disabled:opacity-50" disabled={busy} type="submit">
                  Send
                </button>
              </form>
              {error ? <div className="border border-[#7a3531] bg-[#2a1514] px-3 py-2 text-sm text-[#ffaaa4]">{error}</div> : null}
            </section>
          </div>
        </section>

        <aside className="grid h-screen min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden bg-[#151818] p-4 md:p-5">
          <div className="grid gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#87908b]">Control deck</p>
              <div className="mt-2 grid grid-cols-3 border border-[#2a2f2f] bg-[#101313] p-1">
                <TabButton active={sidePanelTab === "status"} onClick={() => setSidePanelTab("status")}>Status</TabButton>
                <TabButton active={sidePanelTab === "screen"} onClick={() => setSidePanelTab("screen")}>Screen</TabButton>
                <TabButton active={sidePanelTab === "advanced"} onClick={() => setSidePanelTab("advanced")}>Details</TabButton>
              </div>
            </div>
            {latestTool ? <RunStatusBar latestTool={latestTool} /> : <EmptyLine text="Ready. Start with Device status or Screen playlist." />}
          </div>

          <div className="min-h-0 overflow-hidden">
            {sidePanelTab === "status" ? (
              <div className="grid h-full min-h-0 content-start gap-3 overflow-auto pr-1">
                <Panel title="Account">
                  <div className="grid gap-3">
                    <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
                      <KeyValue label="subject" value={authSubject?.kind || "-"} />
                      <KeyValue label="auth" value={authSubject?.authenticated ? "true" : "false"} />
                      <KeyValue label="roles" value={authSubject?.roles?.join(", ") || "-"} />
                      <KeyValue label="org" value={authSubject?.orgId || "-"} />
                      <KeyValue label="device" value={authSubject?.deviceId || "-"} />
                      <KeyValue label="profile" value={authSubject?.deviceProfile || "-"} />
                    </div>
                    <div className="grid gap-2">
                      <input
                        autoComplete="email"
                        className="border border-[#35403f] bg-[#0e1111] px-3 py-2 text-sm text-[#f4efe2]"
                        disabled={authBusy}
                        onChange={(event) => setAuthEmail(event.target.value)}
                        placeholder="owner@walnutpi.local"
                        type="email"
                        value={authEmail}
                      />
                      <input
                        autoComplete="current-password"
                        className="border border-[#35403f] bg-[#0e1111] px-3 py-2 text-sm text-[#f4efe2]"
                        disabled={authBusy}
                        onChange={(event) => setAuthPassword(event.target.value)}
                        placeholder="Password"
                        type="password"
                        value={authPassword}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <button className="border border-[#5f827d] bg-[#142523] px-2 py-2 text-xs font-semibold text-[#eafffb] disabled:opacity-50" disabled={authBusy} onClick={() => submitAuth("sign-up")} type="button">
                          Sign up
                        </button>
                        <button className="border border-[#5f827d] bg-[#142523] px-2 py-2 text-xs font-semibold text-[#eafffb] disabled:opacity-50" disabled={authBusy} onClick={() => submitAuth("sign-in")} type="button">
                          Sign in
                        </button>
                        <button className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] disabled:opacity-50" disabled={authBusy} onClick={signOut} type="button">
                          Sign out
                        </button>
                      </div>
                      {authNotice ? <div className="border border-[#35403f] bg-[#0d0f0f] px-3 py-2 text-xs leading-5 text-[#bfc8c3]">{authNotice}</div> : null}
                    </div>
                  </div>
                </Panel>

                <Panel title="Org Device Binding">
                  <div className="grid gap-3">
                    <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
                      <KeyValue label="orgs" value={String(authManagement?.orgs?.length ?? "-")} />
                      <KeyValue label="devices" value={String(authManagement?.devices?.length ?? "-")} />
                      <KeyValue label="bindings" value={String(authManagement?.bindings?.length ?? "-")} />
                    </div>
                    <div className="grid gap-2">
                      <input
                        className="border border-[#35403f] bg-[#0e1111] px-3 py-2 text-sm text-[#f4efe2]"
                        disabled={authBusy || authSubject?.kind !== "better-auth-user"}
                        onChange={(event) => setBindingDeviceLabel(event.target.value)}
                        placeholder="Device label"
                        value={bindingDeviceLabel}
                      />
                      <input
                        className="border border-[#35403f] bg-[#0e1111] px-3 py-2 text-sm text-[#f4efe2]"
                        disabled={authBusy || authSubject?.kind !== "better-auth-user"}
                        onChange={(event) => setBindingTarget(event.target.value)}
                        placeholder="root@192.168.44.126"
                        value={bindingTarget}
                      />
                      <select
                        className="border border-[#35403f] bg-[#0e1111] px-3 py-2 text-sm text-[#f4efe2]"
                        disabled={authBusy || authSubject?.kind !== "better-auth-user"}
                        onChange={(event) => setBindingRole(event.target.value)}
                        value={bindingRole}
                      >
                        <option value="owner">owner</option>
                        <option value="operator">operator</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button
                        className="border border-[#5f827d] bg-[#142523] px-3 py-2 text-xs font-semibold text-[#eafffb] disabled:opacity-50"
                        disabled={authBusy || authSubject?.kind !== "better-auth-user"}
                        onClick={saveAuthBinding}
                        type="button"
                      >
                        Save server binding
                      </button>
                      {authSubject?.kind !== "better-auth-user" ? <EmptyLine text="Sign in before editing org/device bindings." /> : null}
                    </div>
                  </div>
                </Panel>

                <Panel title="Common checks">
                  <div className="grid grid-cols-2 gap-2">
                    {DEVICE_DIAGNOSTIC_CAPABILITIES.slice(0, 4).map((item) => (
                      <button
                        className="border border-[#35403f] bg-[#101313] px-3 py-2 text-left text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6] disabled:opacity-50"
                        disabled={busy}
                        key={item.capability}
                        onClick={() => runCapability(item)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </Panel>

                <Panel title="Approval">
                  <div className="grid gap-3">
                    {approvals.length ? approvals.slice(0, 1).map((approval) => (
                      <ApprovalCard
                        approval={approval}
                        busy={busy || approval.status === "committing"}
                        key={approval.decisionId}
                        onCommit={() => commitApproval(approval)}
                      />
                    )) : <EmptyLine text="No pending approval." />}
                  </div>
                </Panel>
              </div>
            ) : null}

            {sidePanelTab === "screen" ? (
              <div className="grid h-full min-h-0 content-start gap-3 overflow-auto pr-1">
                <ScreenWorkspacePanel
                  busy={busy}
                  manifestDetail={screenManifestDetail}
                  onRefresh={refreshScreenWorkspace}
                  onGenerate={generateScreenWorkspace}
                  onImportSource={importScreenSource}
                  onLoadManifest={loadManifestDetail}
                  onLoadRecord={loadRecordDetail}
                  onPreview={renderLvglPreview}
                  onProcessImported={processImportedSource}
                  onRunCapability={runCapability}
                  playlist={screenPlaylist}
                  preview={screenPreview}
                  recordDetail={screenRecordDetail}
                  records={screenRecords}
                  screenBusy={screenBusy}
                  screenPrompt={screenPrompt}
                  screenSourceId={screenSourceId}
                  screenSourceUrl={screenSourceUrl}
                  setScreenPrompt={setScreenPrompt}
                  setScreenSourceId={setScreenSourceId}
                  setScreenSourceUrl={setScreenSourceUrl}
                />
              </div>
            ) : null}

            {sidePanelTab === "advanced" ? (
              <div className="grid h-full min-h-0 content-start gap-3 overflow-auto pr-1">
                <Panel title="Tool result">
                  {latestTool ? (
                    <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
                      <KeyValue label="operation" value={latestTool.diagnostics?.operation || "-"} />
                      <KeyValue label="family" value={latestTool.family || "-"} />
                      <KeyValue label="ok" value={String(Boolean(latestTool.ok))} />
                      <KeyValue label="summary" value={latestTool.summary || "-"} />
                    </div>
                  ) : <EmptyLine text="No tool call yet." />}
                </Panel>

                <Panel title="Route">
                  <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
                    <KeyValue label="route" value={lastTurn?.route?.route || "-"} />
                    <KeyValue label="intent" value={lastTurn?.route?.intent || "-"} />
                    <KeyValue label="source" value={lastTurn?.route?.source || "-"} />
                  </div>
                </Panel>

                <Panel title="Evidence">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#aeb8b3]">
                    {latestTool ? JSON.stringify(redactToolEvidence(latestTool.evidence || {}), null, 2) : "No evidence yet."}
                  </pre>
                </Panel>

                <Panel title="Audit trail">
                  <div className="grid gap-2">
                    {auditEvents.length ? auditEvents.slice().reverse().map((event) => (
                      <AuditEventRow event={event} key={`${event.timestamp}-${event.kind}-${event.decisionId || event.turnId || event.toolName || event.operation}`} />
                    )) : <EmptyLine text="No audit events yet." />}
                  </div>
                </Panel>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function ScreenWorkspacePanel({
  busy,
  manifestDetail,
  onRefresh,
  onGenerate,
  onImportSource,
  onLoadManifest,
  onLoadRecord,
  onPreview,
  onProcessImported,
  onRunCapability,
  playlist,
  preview,
  recordDetail,
  records,
  screenBusy,
  screenPrompt,
  screenSourceId,
  screenSourceUrl,
  setScreenPrompt,
  setScreenSourceId,
  setScreenSourceUrl,
}: {
  busy: boolean;
  manifestDetail: ScreenManifestDetail | null;
  onRefresh: () => void;
  onGenerate: () => void;
  onImportSource: () => void;
  onLoadManifest: (manifestId: string) => void;
  onLoadRecord: (buildId: string) => void;
  onPreview: () => void;
  onProcessImported: () => void;
  onRunCapability: (input: JsonObject) => void;
  playlist: ScreenPlaylistView | null;
  preview: ScreenLvglPreview | null;
  recordDetail: ScreenRecordDetail | null;
  records: ScreenRecordSummary[];
  screenBusy: boolean;
  screenPrompt: string;
  screenSourceId: string;
  screenSourceUrl: string;
  setScreenPrompt: (value: string) => void;
  setScreenSourceId: (value: string) => void;
  setScreenSourceUrl: (value: string) => void;
}) {
  return (
    <Panel title="Screen workspace">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-xs text-[#8f9993]">default playlist</div>
          <button
            className="border border-[#35403f] bg-[#101313] px-2 py-1 text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6] disabled:opacity-50"
            disabled={screenBusy}
            onClick={onRefresh}
            type="button"
          >
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6] disabled:opacity-50"
            disabled={busy}
            onClick={() => onRunCapability({ capability: "screen.readPlaylist", text: "screen.readPlaylist", playlistId: "default" })}
            type="button"
          >
            Read
          </button>
          <button
            className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6] disabled:opacity-50"
            disabled={busy}
            onClick={() => onRunCapability({ capability: "screen.captureFrame", text: "screen.captureFrame" })}
            type="button"
          >
            Capture
          </button>
          <button
            className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6] disabled:opacity-50"
            disabled={busy || !playlist?.playlistHash}
            onClick={() => onRunCapability({
              capability: "screen.syncPlaylist",
              text: "screen.syncPlaylist preview",
              playlistHash: playlist?.playlistHash,
              mode: "preview",
              evidenceMode: "fast",
              previewOnly: true,
            })}
            type="button"
          >
            Preview sync
          </button>
        </div>
        <div className="grid gap-2 border border-[#252b2b] bg-[#0d0f0f] p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77807b]">Authoring</div>
          <textarea
            className="h-20 resize-none border border-[#35403f] bg-[#101313] px-3 py-2 text-sm leading-5 text-[#f4efe2]"
            disabled={screenBusy}
            onChange={(event) => setScreenPrompt(event.target.value)}
            placeholder="Generate a terminal-style screen output for the current playlist."
            value={screenPrompt}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              className="border border-[#5f827d] bg-[#142523] px-2 py-2 text-xs font-semibold text-[#eafffb] disabled:opacity-50"
              disabled={screenBusy || !screenPrompt.trim()}
              onClick={onGenerate}
              type="button"
            >
              Generate
            </button>
            <button
              className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] disabled:opacity-50"
              disabled={screenBusy}
              onClick={onPreview}
              type="button"
            >
              LVGL preview
            </button>
          </div>
          <input
            className="border border-[#35403f] bg-[#101313] px-3 py-2 text-xs text-[#f4efe2]"
            disabled={screenBusy}
            onChange={(event) => setScreenSourceUrl(event.target.value)}
            placeholder="https://... source image/gif/video"
            value={screenSourceUrl}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <input
              className="min-w-0 border border-[#35403f] bg-[#101313] px-3 py-2 text-xs text-[#f4efe2]"
              disabled={screenBusy}
              onChange={(event) => setScreenSourceId(event.target.value)}
              placeholder="source id"
              value={screenSourceId}
            />
            <button
              className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] disabled:opacity-50"
              disabled={screenBusy || !screenSourceUrl.trim()}
              onClick={onImportSource}
              type="button"
            >
              Import
            </button>
            <button
              className="border border-[#35403f] bg-[#101313] px-2 py-2 text-xs font-semibold text-[#d7d2c6] disabled:opacity-50"
              disabled={screenBusy || !screenSourceId.trim()}
              onClick={onProcessImported}
              type="button"
            >
              Process
            </button>
          </div>
        </div>
        {preview?.frames?.[0]?.png ? (
          <div className="grid gap-2 border border-[#252b2b] bg-[#0d0f0f] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77807b]">LVGL preview</div>
            <img alt="LVGL playlist preview" className="aspect-[3/2] w-full border border-[#35403f] bg-black object-contain" src={assetUrl(preview.frames[0].png)} />
            <div className="font-mono text-[11px] text-[#9fa9a4]">frames {preview.frames.length} / playlist {preview.playlistHash ? shortId(String(preview.playlistHash)) : "-"}</div>
          </div>
        ) : null}
        {playlist ? <ScreenPlaylistPanel onLoadManifest={onLoadManifest} playlist={playlist} /> : <EmptyLine text="Playlist unavailable." />}
        <ScreenArtifactDetail manifestDetail={manifestDetail} recordDetail={recordDetail} />
        <div className="grid gap-2">
          {records.length ? records.slice(0, 3).map((record, index) => (
            <ScreenRecordRow key={record.buildId || `screen-record-${index}`} onLoadRecord={onLoadRecord} record={record} />
          )) : <EmptyLine text="No screen evidence records." />}
        </div>
      </div>
    </Panel>
  );
}

function RunStatusBar({ latestTool }: { latestTool: JsonObject }) {
  const ok = latestTool.ok === true ? "ok" : latestTool.ok === false ? "needs attention" : "seen";
  return (
    <div className="border border-[#2a2f2f] bg-[#101313] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77807b]">Last run</div>
          <div className="truncate text-sm font-semibold text-[#f4efe2]">{latestTool.summary || latestTool.diagnostics?.operation || "Completed"}</div>
        </div>
        <div className="shrink-0 border border-[#35403f] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9eb7b2]">{ok}</div>
      </div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`px-2 py-2 text-xs font-semibold ${active ? "bg-[#203330] text-[#eafffb]" : "text-[#9fa9a4] hover:bg-[#151818]"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ScreenPlaylistPanel({ onLoadManifest, playlist }: { onLoadManifest: (manifestId: string) => void; playlist: ScreenPlaylistView }) {
  const items = Array.isArray(playlist.items) ? playlist.items : [];
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
        <KeyValue label="hash" value={playlist.playlistHash ? shortId(playlist.playlistHash) : "-"} />
        <KeyValue label="items" value={String(items.length)} />
        <KeyValue label="schema" value={String(playlist.playlist?.schema || "-")} />
      </div>
      <div className="grid gap-2">
        {items.slice(0, 3).map((item, index) => (
          <article className="grid gap-2 border border-[#252b2b] bg-[#0d0f0f] p-3" key={`${item.manifestId || index}-${item.manifestHash || ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[#f4efe2]">{item.manifestId || item.id || `item ${index + 1}`}</div>
              <div className="border border-[#35403f] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9eb7b2]">{item.output?.type || "output"}</div>
            </div>
            <div className="grid gap-1 font-mono text-[11px] leading-5 text-[#9fa9a4]">
              <div>manifest {item.manifestHash ? shortId(String(item.manifestHash)) : "-"}</div>
              <div>duration {String(item.durationMs || "-")} ms</div>
              <div>asset {safeAssetLabel(item.output?.url)}</div>
            </div>
            <button
              className="justify-self-start border border-[#35403f] bg-[#101313] px-2 py-1 text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6]"
              onClick={() => onLoadManifest(String(item.manifestId || ""))}
              type="button"
            >
              Details
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function ScreenArtifactDetail({
  manifestDetail,
  recordDetail,
}: {
  manifestDetail: ScreenManifestDetail | null;
  recordDetail: ScreenRecordDetail | null;
}) {
  const manifest = manifestDetail?.manifest || null;
  const output = manifest?.output || null;
  if (!manifestDetail && !recordDetail) return null;
  return (
    <div className="grid gap-2 border border-[#252b2b] bg-[#0d0f0f] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77807b]">Artifact detail</div>
      {manifestDetail ? (
        <div className="grid gap-1 font-mono text-[11px] leading-5 text-[#9fa9a4]">
          <div>manifest {manifest?.id || "-"}</div>
          <div>schema {manifest?.schema || "-"}</div>
          <div>hash {manifestDetail.manifestHash ? shortId(String(manifestDetail.manifestHash)) : "-"}</div>
          <div>output {output?.type || "-"}</div>
          <div>asset {safeAssetLabel(output?.url || output?.path)}</div>
        </div>
      ) : null}
      {recordDetail ? (
        <div className="grid gap-1 font-mono text-[11px] leading-5 text-[#9fa9a4]">
          <div>record {recordDetail.buildId ? shortId(String(recordDetail.buildId)) : "-"}</div>
          <div>playlist {recordDetail.playlistHash ? shortId(String(recordDetail.playlistHash)) : "-"}</div>
          <div>manifest {recordDetail.manifestHash ? shortId(String(recordDetail.manifestHash)) : "-"}</div>
          <div>visual {recordDetail.visualMatch || recordDetail.webDeviceFrameDiff?.status || "unknown"}</div>
          {recordDetail.framePng?.url ? <img alt="Screen evidence frame" className="mt-2 aspect-[3/2] w-full border border-[#35403f] bg-black object-contain" src={recordDetail.framePng.url} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ScreenRecordRow({ onLoadRecord, record }: { onLoadRecord: (buildId: string) => void; record: ScreenRecordSummary }) {
  const status = record.ok === true ? "ok" : record.ok === false ? "failed" : "seen";
  return (
    <article className="grid gap-2 border border-[#252b2b] bg-[#0d0f0f] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[#f4efe2]">{record.title || record.buildId || "screen record"}</div>
        <div className="border border-[#35403f] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9eb7b2]">{status}</div>
      </div>
      <div className="grid gap-1 font-mono text-[11px] leading-5 text-[#9fa9a4]">
        <div>{formatDate(record.startedAt || record.finishedAt || "")}</div>
        <div>build {record.buildId ? shortId(record.buildId) : "-"}</div>
        <div>playlist {record.playlistHash ? shortId(record.playlistHash) : "-"}</div>
        <div>manifest {record.manifestHash ? shortId(record.manifestHash) : "-"}</div>
        <div>visual {record.visualMatch || record.webDeviceFrameDiffStatus || "unknown"}</div>
        {record.frameUrl && record.hasFramePng ? <a className="text-[#8bcfc6] hover:text-[#d4fff9]" href={record.frameUrl}>frame evidence</a> : null}
      </div>
      <button
        className="justify-self-start border border-[#35403f] bg-[#101313] px-2 py-1 text-xs font-semibold text-[#d7d2c6] hover:border-[#7fbdb6]"
        disabled={!record.buildId}
        onClick={() => onLoadRecord(String(record.buildId || ""))}
        type="button"
      >
        Details
      </button>
    </article>
  );
}

function AuditEventRow({ event }: { event: AuditEvent }) {
  const ok = event.ok === false ? "failed" : event.status === 409 ? "pending" : event.ok === true ? "ok" : "seen";
  const policy = event.policy || {};
  const result = event.result || {};
  return (
    <article className="grid gap-2 border border-[#252b2b] bg-[#0d0f0f] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs text-[#d5d0c4]">{event.kind}</div>
        <div className="border border-[#35403f] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9eb7b2]">{ok}</div>
      </div>
      <div className="grid gap-1 font-mono text-[11px] leading-5 text-[#9fa9a4]">
        <div>{formatDate(event.timestamp)}</div>
        <div>{event.toolName || result.operation || event.operation || "-"}</div>
        {event.actionId || policy.actionId || result.actionId ? <div>action {event.actionId || policy.actionId || result.actionId}</div> : null}
        {event.decisionId ? <div>decision {shortId(event.decisionId)}</div> : null}
        {event.paramsHash ? <div>paramsHash {shortId(event.paramsHash)}</div> : null}
        <div>subject {event.subjectKind || "-"} / {event.deviceProfile || "-"}</div>
        {policy.status ? <div>policy {policy.status} {policy.reason || ""}</div> : null}
        {event.evidenceSummary?.noCommandExecution ? <div>no command construction</div> : null}
      </div>
    </article>
  );
}

function ApprovalCard({
  approval,
  busy,
  onCommit,
}: {
  approval: PreparedApproval;
  busy: boolean;
  onCommit: () => void;
}) {
  const statusTone = approval.status === "committed"
    ? "border-[#4e7e70] bg-[#152520]"
    : approval.status === "failed"
      ? "border-[#7a3531] bg-[#2a1514]"
      : "border-[#7e6835] bg-[#242015]";

  return (
    <div className={`grid gap-3 border p-3 ${statusTone}`}>
      <div>
        <div className="text-sm font-semibold text-[#f4efe2]">{actionTitle(approval.actionId)}</div>
        <div className="font-mono text-[11px] text-[#8f9993]">{approval.actionId}</div>
      </div>
      <div className="grid gap-1 font-mono text-[11px] leading-5 text-[#bac2bd]">
        <div>params {safeParamsSummary(approval.params)}</div>
        <div>paramsHash {approval.paramsHash || "-"}</div>
        <div>catalog binding {approval.commandBindingId || "-"}</div>
        <div>expires {formatDate(approval.expiresAt)}</div>
      </div>
      {approval.explanation ? <p className="text-sm leading-5 text-[#d4cdbd]">{approval.explanation}</p> : null}
      <button
        className="border border-[#78c8bd] bg-[#173230] px-3 py-2 text-sm font-semibold text-[#eafffb] hover:bg-[#1e403d] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || approval.status !== "prepared"}
        onClick={onCommit}
        type="button"
      >
        {approval.status === "committing" ? "Committing" : approval.status === "committed" ? "Committed" : "Approve catalog action"}
      </button>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#2a2f2f] bg-[#101313] p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.22em] text-[#87908b]">{title}</h2>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 border-b border-[#252b2b] pb-1">
      <span className="text-[#77807b]">{label}</span>
      <span className="break-words text-[#d5d0c4]">{value}</span>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="border border-[#252b2b] bg-[#0d0f0f] px-3 py-3 text-sm text-[#89928d]">{text}</div>;
}

async function postTurn(body: JsonObject): Promise<PlatformTurn> {
  const response = await fetch("/api/agent/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if ((!response.ok || data.status === "failed") && !isTypedPlatformTurn(data)) {
    throw new Error(platformTurnText(data) || data.error || "Agent turn failed");
  }
  return data;
}

async function postJson(url: string, body: JsonObject): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.summary || data.output || data.error || `${url} failed`);
  }
  return data;
}

function isTypedPlatformTurn(value: JsonObject) {
  return value?.schema === "walnutpi.agentPlatformTurn.v1"
    && Array.isArray(value.toolResults)
    && Boolean(value.toolResults.at(-1)?.diagnostics?.operation);
}

function approvalFromTurn(turn: PlatformTurn): PreparedApproval | null {
  const latest = turn.toolResults?.at(-1);
  const result = latest?.result || {};
  if (latest?.family !== "policy" || result.operation !== "policy.action.prepare") return null;
  if (!result.decisionId || !result.actionId || !result.approvalToken || result.persisted !== true) return null;
  return {
    actionId: result.actionId,
    approvalToken: result.approvalToken,
    commandBindingId: result.commandBindingId || "",
    decisionId: result.decisionId,
    expiresAt: result.expiresAt || "",
    explanation: result.explanation || "",
    params: result.params && typeof result.params === "object" ? result.params : {},
    paramsHash: result.paramsHash || "",
    status: "prepared",
  };
}

function platformTurnText(turn: PlatformTurn) {
  const latest = turn?.toolResults?.at(-1);
  const payload = latest?.result?.payload || latest?.result?.sync || latest?.result || {};
  return turn?.userSummary
    || latest?.summary
    || payload.output
    || payload.reply
    || payload.summary
    || "";
}

function actionTitle(actionId: string) {
  return {
    reboot: "Reboot WalnutPi",
    reboot_device: "Reboot WalnutPi",
    restart_walnut_screen_service: "Restart screen service",
  }[actionId] || actionId;
}

function safeParamsSummary(params: JsonObject) {
  const entries = Object.entries(params || {});
  if (!entries.length) return "{}";
  return JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [
    key,
    typeof value === "string" ? value.slice(0, 80) : value,
  ])));
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function safeAssetLabel(value: any) {
  const text = String(value || "");
  if (!text) return "-";
  const parts = text.split("/");
  return parts.at(-1) || text.slice(0, 80);
}

function assetUrl(value: string) {
  const text = String(value || "");
  if (!text) return "";
  return text.startsWith("/api/") ? text : `/api/screen/workspace/assets/${encodeURIComponent(text.replace(/^screen\//, ""))}`;
}

function redactToolEvidence(evidence: JsonObject) {
  return JSON.parse(JSON.stringify(evidence, (key, value) => {
    if (/^(approvalToken|rawCommand|sshCommand|remoteCommand|commandLine)$/i.test(key)) return "[redacted]";
    return value;
  }));
}

function getSessionId() {
  if (typeof window === "undefined") return "server";
  const key = "walnut-next-session-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = cryptoId();
  window.localStorage.setItem(key, next);
  return next;
}

function cryptoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}
