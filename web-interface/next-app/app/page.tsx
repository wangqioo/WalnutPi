"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
  kind: string | null;
  roles: string[];
  sessionId: string | null;
  userId: string | null;
};

const QUICK_CAPABILITIES = [
  { label: "Device status", capability: "device.status.read", text: "device.status.read" },
  { label: "Screen playlist", capability: "screen.readPlaylist", text: "screen.readPlaylist" },
  { label: "Prepare restart", capability: "policy.action.prepare", text: "prepare restart_walnut_screen_service", actionId: "restart_walnut_screen_service", params: {} },
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
  const [authNotice, setAuthNotice] = useState("");
  const [error, setError] = useState("");

  const sessionId = useMemo(() => getSessionId(), []);
  const latestTool = lastTurn?.toolResults?.at(-1) || null;

  useEffect(() => {
    refreshAuthSubject();
    refreshAuditEvents();
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
      await refreshAuditEvents();
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
    } catch (caught: any) {
      setAuthNotice(caught.message);
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0f1111] text-[#ece7db]">
      <div className="grid min-h-screen grid-cols-1 xl:grid-cols-[minmax(0,1.12fr)_420px]">
        <section className="flex min-h-0 flex-col border-r border-[#2a2f2f]">
          <header className="border-b border-[#2a2f2f] px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#8a938d]">WalnutPi control plane</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#f4efe2] md:text-5xl">Walnut Agent Console</h1>
              </div>
              <div className="rounded-none border border-[#3a4140] bg-[#151818] px-3 py-2 font-mono text-xs text-[#9eb7b2]">
                session {sessionId.slice(0, 8)} / {authSubject?.kind || "subject unknown"}
              </div>
            </div>
          </header>

          <div className="grid flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 p-4 md:p-6">
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
                  className="min-h-24 resize-y border border-[#35403f] bg-[#0e1111] px-3 py-3 text-sm leading-6 text-[#f4efe2]"
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

        <aside className="grid content-start gap-4 bg-[#151818] p-4 md:p-6">
          <Panel title="Session">
            <div className="grid gap-3">
              <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
                <KeyValue label="subject" value={authSubject?.kind || "-"} />
                <KeyValue label="auth" value={authSubject?.authenticated ? "true" : "false"} />
                <KeyValue label="user" value={authSubject?.userId ? shortId(authSubject.userId) : "-"} />
                <KeyValue label="session" value={authSubject?.sessionId ? shortId(authSubject.sessionId) : "-"} />
                <KeyValue label="roles" value={authSubject?.roles?.join(", ") || "-"} />
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

          <Panel title="Approval queue">
            <div className="grid gap-3">
              {approvals.length ? approvals.map((approval) => (
                <ApprovalCard
                  approval={approval}
                  busy={busy || approval.status === "committing"}
                  key={approval.decisionId}
                  onCommit={() => commitApproval(approval)}
                />
              )) : <EmptyLine text="No prepared catalog action." />}
            </div>
          </Panel>

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

          <Panel title="Audit trail">
            <div className="grid gap-2">
              {auditEvents.length ? auditEvents.slice().reverse().map((event) => (
                <AuditEventRow event={event} key={`${event.timestamp}-${event.kind}-${event.decisionId || event.turnId || event.toolName || event.operation}`} />
              )) : <EmptyLine text="No audit events yet." />}
            </div>
          </Panel>

          <Panel title="Route">
            <div className="grid gap-2 font-mono text-xs text-[#aeb8b3]">
              <KeyValue label="route" value={lastTurn?.route?.route || "-"} />
              <KeyValue label="intent" value={lastTurn?.route?.intent || "-"} />
              <KeyValue label="source" value={lastTurn?.route?.source || "-"} />
            </div>
          </Panel>

          <Panel title="Evidence">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#aeb8b3]">
              {latestTool ? JSON.stringify(redactToolEvidence(latestTool.evidence || {}), null, 2) : "No evidence yet."}
            </pre>
          </Panel>
        </aside>
      </div>
    </main>
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
  if (!response.ok || data.status === "failed") {
    throw new Error(platformTurnText(data) || data.error || "Agent turn failed");
  }
  return data;
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
