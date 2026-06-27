import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonObject = Record<string, any>;
type RemoteRunResult = {
  code: number | null;
  ok: boolean;
  output: string;
  remoteTransport?: string | null;
  reusedConnection?: boolean | null;
};

type RuntimeFile = {
  content: Buffer | string;
  mode: string;
  path: string;
};

export type WidgetAppDeviceAdapter = {
  deliverCurrentRuntime(options?: {
    appId?: string | null;
    evidenceMode?: "fast" | "full";
    versionId?: string | null;
  }): Promise<JsonObject>;
  runAction(options: {
    actionId: string;
    params?: JsonObject;
  }): Promise<JsonObject>;
};

export function createWidgetAppDeviceAdapter({
  screenWorkspaceRoot,
  remoteProjectRoot,
  remoteBuildUser,
  sshHost,
  sshUser,
  runRemoteRaw,
  runRemoteRawWithInput,
}: {
  screenWorkspaceRoot: string;
  remoteProjectRoot: string;
  remoteBuildUser?: string | null;
  sshHost: string;
  sshUser: string;
  runRemoteRaw: (command: string, timeoutMs?: number, limit?: number) => Promise<RemoteRunResult>;
  runRemoteRawWithInput: (command: string, input: Buffer, timeoutMs?: number, limit?: number) => Promise<RemoteRunResult>;
}): WidgetAppDeviceAdapter {
  const workspaceRoot = path.resolve(screenWorkspaceRoot);
  const runtimeRoot = path.join(workspaceRoot, "widget-runtime");

  return {
    async deliverCurrentRuntime(options = {}) {
      const current = await readJsonFile(path.join(runtimeRoot, "current.json"));
      const state = await readJsonFile(path.join(runtimeRoot, "state.json"));
      const requestedAppId = cleanOptionalText(options.appId);
      const requestedVersionId = cleanOptionalText(options.versionId);
      if (requestedAppId && requestedAppId !== current.appId) {
        return failedBeforeRemote("requested appId does not match active Widget App runtime", current, state);
      }
      if (requestedVersionId && requestedVersionId !== current.versionId) {
        return failedBeforeRemote("requested versionId does not match active Widget App runtime", current, state);
      }

      const slice = await buildWidgetRuntimeSlice({
        current,
        runtimeRoot,
        state,
        workspaceRoot,
      });
      const archive = await createSliceArchive(slice.files);
      const delivery = await runRemoteRawWithInput(
        buildRuntimeDeliveryCommand({
          fileCount: slice.files.length,
          remoteBuildUser,
          remoteProjectRoot,
        }),
        archive,
        30_000,
        20_000,
      );
      const validate = delivery.ok
        ? await runRemoteRaw(buildRuntimeValidationCommand({ remoteProjectRoot, runtimeSha256: slice.runtimeSha256 }), 20_000, 20_000)
        : skippedRemoteResult("skipped because Widget App runtime delivery failed");
      const activate = validate.ok
        ? await runRemoteRaw(buildRuntimeActivationCommand({ remoteProjectRoot }), 20_000, 20_000)
        : skippedRemoteResult("skipped because Widget App runtime validation failed");
      const evidence = activate.ok && options.evidenceMode === "full"
        ? await runRemoteRaw("walnut screen state && sudo -n walnut screen frame", 20_000, 30_000)
        : skippedRemoteResult(options.evidenceMode === "full"
          ? "skipped because Widget App activation failed"
          : "skipped because fast evidence mode only checks service activation");

      const stages = {
        delivery: publicStage(delivery),
        validate: publicStage(validate),
        activate: publicStage(activate),
        evidence: publicStage(evidence),
      };
      const ok = delivery.ok && validate.ok && activate.ok && (options.evidenceMode !== "full" || evidence.ok);
      return {
        ok,
        adapter: "ssh-widget-app-runtime",
        operation: "screen.widgetApp.sync",
        risk: "write-low",
        mode: "remote",
        summary: ok
          ? "Widget App runtime delivered and activated through the typed device boundary."
          : "Widget App runtime delivery reached the typed device boundary but did not complete.",
        current: publicCurrent(current, state),
        widgetRuntime: {
          runtimeIndex: "screen/widget-runtime/current.txt",
          activeRuntimeIndex: "screen/runtime/default.txt",
          runtimeSha256: slice.runtimeSha256,
          fileCount: slice.files.length,
          missingArtifactReferences: slice.missingArtifactReferences,
        },
        activation: {
          strategy: "copy-widget-runtime-to-active-runtime-hot-reload",
          serviceState: parseServiceState(activate.output),
        },
        target: {
          host: sshHost,
          user: sshUser,
          buildUser: remoteBuildUser || sshUser,
        },
        stages,
        remoteExecution: summarizeRemoteExecution([delivery, validate, activate, evidence]),
        diagnostics: {
          commandBoundary: "internal-adapter-only",
          rawCommandExposed: false,
        },
      };
    },
    async runAction(options) {
      const actionId = cleanOptionalText(options.actionId);
      if (actionId === "refresh_device_status") return runRefreshDeviceStatus(runRemoteRaw);
      if (actionId === "restart_walnut_screen_service") return runRestartWalnutScreenService(runRemoteRaw);
      if (actionId === "reboot_device") return runRebootDevice(runRemoteRaw);
      return {
        ok: false,
        adapter: "ssh-widget-app-action",
        operation: "screen.widgetApp.action",
        actionId,
        reason: "unsupported-widget-app-device-action",
        diagnostics: {
          commandBoundary: "not-reached",
          rawCommandExposed: false,
        },
      };
    },
  };
}

async function runRefreshDeviceStatus(runRemoteRaw: (command: string, timeoutMs?: number, limit?: number) => Promise<RemoteRunResult>) {
  const actionId = "refresh_device_status";
  const status = await runRemoteRaw(buildRefreshDeviceStatusCommand(), 20_000, 20_000);
  const parsedStatus = parseJsonOutput(status.output);
  const publicStatus = publicDeviceStatus(parsedStatus);
  return {
    ok: Boolean(status.ok && publicStatus),
    adapter: "ssh-widget-app-action",
    operation: "screen.widgetApp.action",
    actionId,
    summary: status.ok
      ? "Widget App device status binding refreshed through the typed device adapter."
      : "Widget App device status refresh reached the typed device adapter but did not complete.",
    result: {
      actionId,
      refreshed: Boolean(status.ok && publicStatus),
      status: publicStatus,
    },
    evidence: {
      deviceBoundaryReached: true,
      readOnlyDeviceAction: true,
      noRawCommandExposure: true,
      noRawDeviceOutputExposure: true,
    },
    stages: {
      refresh: publicStage(status),
    },
    remoteExecution: summarizeRemoteExecution([status]),
    diagnostics: {
      commandBoundary: "internal-adapter-only",
      rawCommandExposed: false,
      parseOk: Boolean(publicStatus),
    },
  };
}

async function runRestartWalnutScreenService(runRemoteRaw: (command: string, timeoutMs?: number, limit?: number) => Promise<RemoteRunResult>) {
  const actionId = "restart_walnut_screen_service";
  const restart = await runRemoteRaw(buildRestartWalnutScreenServiceCommand(), 30_000, 20_000);
  return {
    ok: Boolean(restart.ok),
    adapter: "ssh-widget-app-action",
    operation: "screen.widgetApp.action",
    actionId,
    summary: restart.ok
      ? "Walnut screen service restart executed through the typed Widget App device adapter."
      : "Walnut screen service restart reached the typed Widget App device adapter but did not complete.",
    result: {
      actionId,
      restarted: Boolean(restart.ok),
      serviceState: parseServiceState(restart.output),
    },
    evidence: {
      deviceBoundaryReached: true,
      approvedDeviceAction: true,
      serviceRestartRequested: true,
      noRawCommandExposure: true,
      noRawDeviceOutputExposure: true,
    },
    stages: {
      restart: publicStage(restart),
    },
    remoteExecution: summarizeRemoteExecution([restart]),
    diagnostics: {
      commandBoundary: "internal-adapter-only",
      rawCommandExposed: false,
    },
  };
}

async function runRebootDevice(runRemoteRaw: (command: string, timeoutMs?: number, limit?: number) => Promise<RemoteRunResult>) {
  const actionId = "reboot_device";
  const reboot = await runRemoteRaw(buildRebootDeviceCommand(), 10_000, 8_000);
  return {
    ok: Boolean(reboot.ok),
    adapter: "ssh-widget-app-action",
    operation: "screen.widgetApp.action",
    actionId,
    summary: reboot.ok
      ? "WalnutPi reboot action was handed to the typed Widget App device adapter."
      : "WalnutPi reboot action reached the typed Widget App device adapter but did not report clean completion.",
    result: {
      actionId,
      rebootRequested: Boolean(reboot.ok),
    },
    evidence: {
      deviceBoundaryReached: true,
      approvedDeviceAction: true,
      rebootRequested: Boolean(reboot.ok),
      noRawCommandExposure: true,
      noRawDeviceOutputExposure: true,
    },
    stages: {
      reboot: publicStage(reboot),
    },
    remoteExecution: summarizeRemoteExecution([reboot]),
    diagnostics: {
      commandBoundary: "internal-adapter-only",
      rawCommandExposed: false,
    },
  };
}

function buildRefreshDeviceStatusCommand() {
  return "walnut action run status --json";
}

function buildRestartWalnutScreenServiceCommand() {
  return [
    "set -e",
    "sudo -n systemctl restart walnut-screen.service",
    "sleep 1",
    "screen_state=$(systemctl is-active walnut-screen.service)",
    "printf 'walnut-screen.service %s\\n' \"$screen_state\"",
    'test "$screen_state" = active',
  ].join("; ");
}

function buildRebootDeviceCommand() {
  return [
    "set -e",
    "sudo -n reboot",
    "printf 'reboot-requested\\n'",
  ].join("; ");
}

async function buildWidgetRuntimeSlice({
  current,
  runtimeRoot,
  state,
  workspaceRoot,
}: {
  current: JsonObject;
  runtimeRoot: string;
  state: JsonObject;
  workspaceRoot: string;
}) {
  const files: RuntimeFile[] = [];
  const missingArtifactReferences: string[] = [];
  await addFile(files, runtimeRoot, "current.txt", "screen/widget-runtime/current.txt");
  await addFile(files, runtimeRoot, "current.json", "screen/widget-runtime/current.json");
  await addFile(files, runtimeRoot, "state.json", "screen/widget-runtime/state.json");
  await addOptionalFile(files, runtimeRoot, "events.log", "screen/widget-runtime/events.log");
  for (const reference of [current.app, current.catalog, current.a2uiSurface]) {
    const missing = await addReferencedScreenFile(files, workspaceRoot, reference);
    if (missing) missingArtifactReferences.push(missing);
  }
  const runtimeText = await readFile(path.join(runtimeRoot, "current.txt"), "utf8");
  return {
    files,
    missingArtifactReferences,
    runtimeSha256: sha256(runtimeText),
    current,
    state,
  };
}

async function addFile(files: RuntimeFile[], root: string, sourceName: string, archivePath: string) {
  const sourcePath = path.join(root, sourceName);
  assertInsideRoot(root, sourcePath, "Widget App runtime file escapes runtime root");
  files.push({
    path: archivePath,
    mode: "644",
    content: await readFile(sourcePath),
  });
}

async function addOptionalFile(files: RuntimeFile[], root: string, sourceName: string, archivePath: string) {
  const sourcePath = path.join(root, sourceName);
  try {
    await stat(sourcePath);
  } catch {
    return;
  }
  await addFile(files, root, sourceName, archivePath);
}

async function addReferencedScreenFile(files: RuntimeFile[], workspaceRoot: string, reference: any) {
  const cleanReference = String(reference || "").trim();
  if (!cleanReference) return null;
  const sourcePath = path.resolve(workspaceRoot, "widget-runtime", cleanReference);
  assertInsideRoot(workspaceRoot, sourcePath, "Widget App referenced file escapes screen workspace");
  const relative = path.relative(workspaceRoot, sourcePath).replaceAll("\\", "/");
  let content: Buffer;
  try {
    content = await readFile(sourcePath);
  } catch {
    return relative;
  }
  files.push({
    path: `screen/${relative}`,
    mode: "644",
    content,
  });
  return null;
}

async function createSliceArchive(files: RuntimeFile[]) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "walnutpi-widget-runtime-"));
  const stageDir = path.join(tempRoot, "stage");
  const archivePath = path.join(tempRoot, "widget-runtime.tar.gz");
  try {
    await mkdir(stageDir, { recursive: true });
    for (const file of files) {
      const relativePath = safeArchivePath(file.path);
      const outputPath = path.join(stageDir, ...relativePath.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, file.content);
      await chmod(outputPath, Number.parseInt(file.mode, 8));
    }
    await runTar(["-czf", archivePath, "-C", stageDir, "."]);
    return await readFile(archivePath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function buildRuntimeDeliveryCommand({
  fileCount,
  remoteBuildUser,
  remoteProjectRoot,
}: {
  fileCount: number;
  remoteBuildUser?: string | null;
  remoteProjectRoot: string;
}) {
  const lines = [
    "set -e",
    `ROOT=${shSingleQuote(remoteProjectRoot)}`,
    'install -d "$ROOT"',
    'tar -xzf - -C "$ROOT"',
    'install -d "$ROOT/screen/runtime" "$ROOT/screen/widget-runtime"',
  ];
  if (remoteBuildUser) {
    lines.push(`chown -R ${shSingleQuote(`${remoteBuildUser}:${remoteBuildUser}`)} "$ROOT/screen/runtime" "$ROOT/screen/widget-runtime" "$ROOT/screen/apps" 2>/dev/null || true`);
  }
  lines.push("printf 'widget runtime slice delivered: %s files\\n' " + shSingleQuote(String(fileCount)));
  return lines.join("; ");
}

function buildRuntimeValidationCommand({
  remoteProjectRoot,
  runtimeSha256,
}: {
  remoteProjectRoot: string;
  runtimeSha256: string;
}) {
  return [
    "set -e",
    `ROOT=${shSingleQuote(remoteProjectRoot)}`,
    'cd "$ROOT"',
    "test -x build/lvgl_app/walnut-lvgl-screen",
    "strings build/lvgl_app/walnut-lvgl-screen | grep -F walnutpi.lvgl-widget-runtime.v1 >/dev/null",
    "test -f screen/widget-runtime/current.txt",
    "grep -F 'schema walnutpi.lvgl-widget-runtime.v1' screen/widget-runtime/current.txt >/dev/null",
    `test "$(sha256sum screen/widget-runtime/current.txt | awk '{print $1}')" = ${shSingleQuote(runtimeSha256)}`,
    "printf 'widget-runtime-sha256=%s\\n' " + shSingleQuote(runtimeSha256),
  ].join("; ");
}

function buildRuntimeActivationCommand({ remoteProjectRoot }: { remoteProjectRoot: string }) {
  return [
    "set -e",
    `ROOT=${shSingleQuote(remoteProjectRoot)}`,
    'cd "$ROOT"',
    "cp screen/widget-runtime/current.txt screen/runtime/default.txt",
    "sleep 1",
    "screen_state=$(systemctl is-active walnut-screen.service)",
    "printf 'walnut-screen.service %s\\n' \"$screen_state\"",
    'test "$screen_state" = active',
  ].join("; ");
}

function failedBeforeRemote(reason: string, current: JsonObject, state: JsonObject) {
  return {
    ok: false,
    adapter: "ssh-widget-app-runtime",
    operation: "screen.widgetApp.sync",
    reason,
    current: publicCurrent(current, state),
    stages: {},
    diagnostics: {
      commandBoundary: "not-reached",
      rawCommandExposed: false,
    },
  };
}

function publicCurrent(current: JsonObject, state: JsonObject) {
  return {
    appId: current.appId || null,
    versionId: current.versionId || null,
    activatedAt: current.activatedAt || null,
    stateUpdatedAt: state.updatedAt || null,
  };
}

function publicStage(result: RemoteRunResult) {
  return {
    ok: Boolean(result.ok),
    code: result.code,
    outputSha256: sha256(result.output || ""),
    outputLength: String(result.output || "").length,
    remoteTransport: result.remoteTransport || null,
    reusedConnection: typeof result.reusedConnection === "boolean" ? result.reusedConnection : null,
  };
}

function parseJsonOutput(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function publicDeviceStatus(value: JsonObject | null) {
  if (!value) return null;
  const output = parseJsonOutput(String(value.output || ""));
  const source = output || value;
  return {
    ok: Boolean(value.ok),
    id: cleanOptionalText(value.id),
    title: cleanOptionalText(value.title),
    serviceState: firstString(source, ["walnutScreenService", "walnut-screen.service", "screenService", "serviceState"]),
    hostname: firstString(source, ["hostname", "host"]),
    primaryIp: firstString(source, ["primaryIp", "ip", "address"]),
    memory: publicNested(source.memory || source.mem),
    disk: publicNested(source.disk || source.storage),
    checkedAt: new Date().toISOString(),
  };
}

function publicNested(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")
      .slice(0, 8),
  );
}

function firstString(source: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return null;
}

function summarizeRemoteExecution(results: RemoteRunResult[]) {
  const transports = results.map((result) => result.remoteTransport).filter(Boolean);
  const reused = results
    .map((result) => result.reusedConnection)
    .filter((value) => typeof value === "boolean");
  return {
    remoteTransport: transports[0] || null,
    connectionReused: reused.length ? reused.some(Boolean) : null,
  };
}

function skippedRemoteResult(output: string): RemoteRunResult {
  return {
    ok: false,
    code: null,
    output,
    remoteTransport: null,
    reusedConnection: null,
  };
}

async function readJsonFile(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function parseServiceState(output: string) {
  return String(output || "").match(/\bwalnut-screen\.service\s+([a-z-]+)/)?.[1] || null;
}

function safeArchivePath(filePath: string) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error(`Widget App slice path is not archive-safe: ${filePath}`);
  }
  return normalized;
}

function runTar(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("tar", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

function assertInsideRoot(root: string, target: string, message: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function shSingleQuote(value: string) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function cleanOptionalText(value: any) {
  return String(value || "").trim();
}
