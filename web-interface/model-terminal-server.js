import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const SSH_HOST = process.env.SSH_HOST || "192.168.1.24";
const SSH_USER = process.env.SSH_USER || "root";
const SSH_PASSWORD = process.env.SSH_PASSWORD || "root";
const BASE_DIR = import.meta.dir;
const MODEL_FILE = "0c6390ea8b1ccf186ec099456954fd42.glb";
const ACTION_OUTPUT_LIMIT = 24_000;
const CAPTURE_OUTPUT_LIMIT = 1_500_000;
const SCREEN_FRAME_TICKET_TTL_MS = 10 * 60_000;
const screenFrameTickets = new Map();

const SCREEN_MANIFEST = {
  schema: "walnutpi.screen.v1",
  id: "walnutpi-lvgl-status",
  title: "WalnutPi",
  subtitle: "server screen",
  target: {
    runtime: "lvgl-fbdev",
    display: "/dev/fb0",
    width: 480,
    height: 320,
    color: "RGB565",
  },
  source: {
    lvglEntry: "lvgl_app/src/main.c",
    command: "walnut screen start",
  },
  pages: [
    {
      id: "home",
      tab: "HOME",
      status: "OK CORE",
      metrics: ["IP loading", "MEM --", "DISK --"],
    },
    {
      id: "system",
      tab: "SYS",
      title: "System",
      lines: ["CPU load", "Memory", "Disk", "Uptime"],
    },
    {
      id: "ai",
      tab: "AI",
      title: "AI Agent",
      lines: ["Local shell online", "Cloud model ready", "Screen cards active"],
    },
    {
      id: "network",
      tab: "NET",
      title: "Network",
      lines: ["IP", "FRP", "SSH", "Display fbdev"],
    },
  ],
};

const files = new Map([
  ["/", "model-terminal.html"],
  ["/model-terminal.html", "model-terminal.html"],
  ["/ssh-terminal.html", "ssh-terminal.html"],
  [`/${MODEL_FILE}`, MODEL_FILE],
]);

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
]);

function contentType(pathname) {
  const extension = pathname.match(/\.[^.]+$/)?.[0] || "";
  return mime.get(extension) || "application/octet-stream";
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function previewOnly(url) {
  return url.searchParams.has("nossh");
}

function previewOnlyJson() {
  return json(
    {
      ok: false,
      title: "预览模式",
      failedStage: "preview",
      summary: "预览模式下不会连接核桃派。",
      output: "preview mode disables SSH, build, delivery, activation, and device writes",
    },
    403,
  );
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function limitedOutput(value, limit = ACTION_OUTPUT_LIMIT) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[local] output truncated`;
}

function runRemote(command, timeoutMs = 15_000, outputLimit = ACTION_OUTPUT_LIMIT) {
  return new Promise((resolve) => {
    const target = `${SSH_USER}@${SSH_HOST}`;
    const child = spawn(
      "sshpass",
      [
        "-e",
        "ssh",
        "-T",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-o",
        "ConnectTimeout=8",
        target,
        `sh -lc ${shellQuote(command)}`,
      ],
      {
        env: {
          ...process.env,
          SSHPASS: SSH_PASSWORD,
          TERM: "xterm-256color",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        output: limitedOutput(`${stdout}${stderr}\n[local] action timed out`.trim(), outputLimit),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: `[local] ${error.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok", outputLimit);
      resolve({ ok: code === 0, code, output });
    });
  });
}

function commandBlockResult(name, result) {
  return [
    `## ${name}`,
    `ok=${result.ok}`,
    `code=${result.code ?? "timeout"}`,
    result.output,
  ]
    .filter(Boolean)
    .join("\n");
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function parseFrameEvidence(result) {
  if (!result.ok) return null;
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

function validFrameEvidence(frame) {
  return Boolean(
    frame
      && typeof frame === "object"
      && validSha256(frame.sha256)
      && Number.isInteger(frame.byteLength)
      && frame.byteLength > 0
      && (!Number.isInteger(frame.expectedByteLength) || frame.expectedByteLength === frame.byteLength),
  );
}

function frameUrl(buildId) {
  return `/api/screen/frame/${encodeURIComponent(buildId)}`;
}

function cleanupScreenFrameTickets() {
  const now = Date.now();
  for (const [buildId, ticket] of screenFrameTickets.entries()) {
    if (now - ticket.createdAt > SCREEN_FRAME_TICKET_TTL_MS) {
      screenFrameTickets.delete(buildId);
    }
  }
}

function rememberScreenFrameTicket(buildId, ticket) {
  cleanupScreenFrameTickets();
  screenFrameTickets.set(buildId, {
    ...ticket,
    createdAt: Date.now(),
  });
}

function visualStatus(manifest, artifactHashValid, frameEvidence) {
  const frameCaptured = validFrameEvidence(frameEvidence);
  const target = manifest.target || {};
  const visualChecks = {
    manifestHashMatched: true,
    artifactHashValid,
    frameCaptured,
    frameDimensionsMatched: frameCaptured
      && frameEvidence.width === target.width
      && frameEvidence.height === target.height,
    framePixelFormatMatched: frameCaptured
      && target.color === "RGB565"
      && (frameEvidence.pixelFormat === "RGB565_LE" || frameEvidence.bitsPerPixel === 16),
    frameByteLengthMatched: frameCaptured
      && Number.isInteger(frameEvidence.expectedByteLength)
      && frameEvidence.expectedByteLength === frameEvidence.byteLength,
    frameNonblank: frameCaptured
      && frameEvidence.isBlank === false
      && Number(frameEvidence.nonzeroBytes || 0) > 0,
  };
  if (!frameCaptured) {
    return { visualMatch: "unknown", visualChecks };
  }
  return {
    visualMatch: Object.values(visualChecks).every(Boolean) ? "captured" : "mismatch",
    visualChecks,
  };
}

function validPngBytes(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return bytes.length > signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function parseCaptureResult(result) {
  if (!result.ok) return null;
  let capture;
  try {
    capture = JSON.parse(result.output);
  } catch {
    return null;
  }

  if (!capture || typeof capture !== "object" || !validSha256(capture.pngSha256) || typeof capture.pngBase64 !== "string") {
    return null;
  }

  const bytes = Buffer.from(capture.pngBase64, "base64");
  if (!validPngBytes(bytes) || sha256(bytes) !== capture.pngSha256) {
    return null;
  }
  return { capture, bytes };
}

async function handleScreenFrame(buildId) {
  cleanupScreenFrameTickets();
  const ticket = screenFrameTickets.get(buildId);
  if (!ticket) {
    return json(
      {
        ok: false,
        error: "unknown or expired screen frame",
        summary: "screen frame evidence is only available after a recent successful sync",
      },
      404,
    );
  }

  const captureResult = await runRemote("sudo -n walnut screen capture --png-base64", 30_000, CAPTURE_OUTPUT_LIMIT);
  const parsed = parseCaptureResult(captureResult);
  if (!parsed) {
    return json(
      {
        ok: false,
        error: "screen capture failed",
        output: captureResult.output,
      },
      502,
    );
  }

  if (ticket.frameSha256 && parsed.capture.rawSha256 !== ticket.frameSha256) {
    return json(
      {
        ok: false,
        error: "screen frame changed",
        expectedRawSha256: ticket.frameSha256,
        actualRawSha256: parsed.capture.rawSha256,
      },
      409,
    );
  }

  return new Response(parsed.bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
      "x-walnut-png-sha256": parsed.capture.pngSha256,
      "x-walnut-raw-sha256": parsed.capture.rawSha256,
      "x-walnut-manifest-sha256": ticket.manifestHash,
      "x-walnut-artifact-sha256": ticket.artifactHash || "",
    },
  });
}

function firstFailure(buildResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual) {
  if (!buildResult.ok) {
    return {
      stage: "build",
      summary: "LVGL 构建失败。请在诊断里查看第一处编译错误。",
    };
  }
  if (!validSha256(artifactHash)) {
    return {
      stage: "artifact",
      summary: "LVGL 产物哈希校验失败。请在诊断里确认构建产物是否存在。",
    };
  }
  if (!activateResult.ok) {
    return {
      stage: "activate",
      summary: "核桃派屏幕激活失败。请确认 walnut-screen.service 已安装并允许 sudo 执行。",
    };
  }
  if (!stateResult.ok) {
    return {
      stage: "evidence",
      summary: "屏幕状态回证失败。请检查 SSH 连接和 walnut screen state 输出。",
    };
  }
  if (!frameResult.ok || !validFrameEvidence(frameEvidence)) {
    return {
      stage: "frame",
      summary: "屏幕画面回证失败。请在诊断里查看 framebuffer 读取结果。",
    };
  }
  if (visual.visualMatch !== "captured") {
    return {
      stage: "visual",
      summary: "屏幕画面回证和目标屏幕约束不一致。请在诊断里查看 frame checks。",
    };
  }
  return null;
}

function screenManifestEnvelope() {
  const serializedManifest = stableStringify(SCREEN_MANIFEST);
  return {
    manifest: SCREEN_MANIFEST,
    manifestHash: sha256(serializedManifest),
  };
}

async function handleScreenSync(req) {
  const startedAt = new Date();
  const buildId = `screen-${startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const { manifest, manifestHash } = screenManifestEnvelope();
  let body = {};
  try {
    body = await req.json();
  } catch {
    return json(
      {
        ok: false,
        title: "同步到核桃派",
        failedStage: "manifest",
        manifestHash,
        summary: "同步请求缺少有效的 screen manifest hash，请刷新页面后再同步。",
        output: "request body is not valid JSON",
      },
      400,
    );
  }
  if (typeof body.manifestHash !== "string" || !validSha256(body.manifestHash)) {
    return json(
      {
        ok: false,
        title: "同步到核桃派",
        failedStage: "manifest",
        manifestHash,
        summary: body.manifestHash
          ? "同步请求包含无效的 screen manifest hash，请刷新页面后再同步。"
          : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
        output: `client=${body.manifestHash || "(missing)"}\nserver=${manifestHash}`,
      },
      400,
    );
  }

  if (body.manifestHash !== manifestHash) {
    return json(
      {
        ok: false,
        title: "同步到核桃派",
        failedStage: "manifest",
        manifestHash,
        summary: body.manifestHash
          ? "Web 预览和服务器 screen manifest 不一致，请刷新后再同步。"
          : "同步请求缺少 screen manifest hash，请刷新页面后再同步。",
        output: `client=${body.manifestHash || "(missing)"}\nserver=${manifestHash}`,
      },
      body.manifestHash ? 409 : 400,
    );
  }

  const buildCommand = [
    "set -e",
    "ROOT=${WALNUT_PROJECT_ROOT:-$HOME/projects/WalnutPi}",
    'cd "$ROOT"',
    "scripts/build-lvgl-app.sh",
  ].join("; ");
  const activateCommand = "sudo -n walnut screen start";
  const stateCommand = "walnut screen state";
  const frameCommand = "sudo -n walnut screen frame";

  const buildResult = await runRemote(buildCommand, 120_000);
  const artifactResult = buildResult.ok
    ? await runRemote(
        'set -e; ROOT=${WALNUT_PROJECT_ROOT:-$HOME/projects/WalnutPi}; cd "$ROOT"; test -x build/lvgl_app/walnut-lvgl-screen; sha256sum build/lvgl_app/walnut-lvgl-screen | awk \'{print $1}\'',
        10_000,
      )
    : { ok: false, code: null, output: "skipped because build failed" };
  const artifactHash = artifactResult.ok ? artifactResult.output.trim().split(/\s+/)[0] : null;
  const artifactHashValid = validSha256(artifactHash);
  const deliveryManifest = {
    schema: "walnutpi.delivery.v1",
    buildId,
    adapter: "ssh-local-agent",
    risk: "write-low",
    artifact: {
      name: "walnut-lvgl-screen",
      path: "build/lvgl_app/walnut-lvgl-screen",
      source: "lvgl_app/src/main.c",
      sha256: artifactHashValid ? artifactHash : null,
    },
    target: {
      host: SSH_HOST,
      user: SSH_USER,
      display: manifest.target.display,
      activate: activateCommand,
      evidence: [stateCommand, frameCommand],
    },
    screenManifestHash: manifestHash,
  };
  const deliveryHash = sha256(stableStringify(deliveryManifest));
  const activateResult = buildResult.ok && artifactHashValid
    ? await runRemote(activateCommand, 30_000)
    : {
        ok: false,
        code: null,
        output: buildResult.ok ? "skipped because artifact hash is invalid" : "skipped because build failed",
      };
  const stateResult = buildResult.ok && artifactHashValid && activateResult.ok
    ? await runRemote(stateCommand, 15_000)
    : {
        ok: false,
        code: null,
        output: !buildResult.ok
          ? "skipped because build failed"
          : artifactHashValid
            ? "skipped because activation failed"
            : "skipped because artifact hash is invalid",
      };
  const frameResult = buildResult.ok && artifactHashValid && activateResult.ok && stateResult.ok
    ? await runRemote(frameCommand, 15_000)
    : {
        ok: false,
        code: null,
        output: !buildResult.ok
          ? "skipped because build failed"
          : !artifactHashValid
            ? "skipped because artifact hash is invalid"
            : !activateResult.ok
              ? "skipped because activation failed"
              : "skipped because screen state evidence failed",
      };
  const frameEvidence = parseFrameEvidence(frameResult);
  if (frameEvidence) {
    frameEvidence.capturedAt = new Date().toISOString();
    frameEvidence.command = frameCommand;
  }

  const visual = visualStatus(manifest, artifactHashValid, frameEvidence);
  const frameImageUrl = validFrameEvidence(frameEvidence) ? frameUrl(buildId) : null;
  if (frameImageUrl) {
    rememberScreenFrameTicket(buildId, {
      manifestHash,
      artifactHash: artifactHashValid ? artifactHash : null,
      frameSha256: frameEvidence.sha256,
    });
  }

  const failure = firstFailure(buildResult, artifactHash, activateResult, stateResult, frameResult, frameEvidence, visual);
  const screenEvidence = {
    kind: "screen-frame",
    visualMatch: visual.visualMatch,
    visualChecks: visual.visualChecks,
    state: {
      kind: "screen-state",
      command: stateCommand,
      output: stateResult.output,
      capturedAt: new Date().toISOString(),
    },
    frame: validFrameEvidence(frameEvidence)
      ? {
          ...frameEvidence,
          url: frameImageUrl,
        }
      : {
          command: frameCommand,
          output: frameResult.output,
          capturedAt: new Date().toISOString(),
        },
  };
  const output = limitedOutput(
    [
      commandBlockResult("build", buildResult),
      commandBlockResult("artifact", artifactResult),
      commandBlockResult("activate", activateResult),
      commandBlockResult("evidence", stateResult),
      commandBlockResult("frame", frameResult),
    ].join("\n\n"),
  );

  return json({
    ok: failure === null,
    title: "同步到核桃派",
    risk: "write-low",
    mode: "remote",
    buildId,
    manifest,
    manifestHash,
    deliveryManifest,
    deliveryHash,
    artifactHash: artifactHashValid ? artifactHash : null,
    evidence: screenEvidence,
    screenEvidence,
    screenFrameUrl: frameImageUrl,
    command: `${buildCommand}\n${activateCommand}\n${stateCommand}\n${frameCommand}`,
    code: failure ? 1 : 0,
    output,
    summary: failure
      ? failure.summary
      : "已同步到核桃派。Web 预览和设备运行使用同一个 screen manifest。",
    failedStage: failure?.stage || null,
  });
}

const ACTIONS = {
  status: {
    title: "查状态",
    risk: "read",
    mode: "remote",
    command: "walnut status",
    reply: "我会读取系统、网络、存储、服务和音频状态。",
    timeoutMs: 20_000,
  },
  snapshot: {
    title: "设备快照",
    risk: "read",
    mode: "remote",
    command: [
      "hostname",
      "uname -a",
      "cat /etc/WalnutPi-release 2>/dev/null || true",
      "cat /etc/os-release 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
      "gpio pins 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
    ].join("; "),
    reply: "我会先做只读设备快照，确认板子、系统、引脚和 overlay 状态。",
    timeoutMs: 20_000,
  },
  network: {
    title: "网络检查",
    risk: "read",
    mode: "remote",
    command: [
      "ip -br addr",
      "ip route show default",
      "nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi 2>/dev/null || true",
    ].join("; "),
    reply: "我会检查 IP、默认路由和 Wi-Fi 状态。",
    timeoutMs: 12_000,
  },
  gpio: {
    title: "GPIO 检查",
    risk: "read",
    mode: "remote",
    command: [
      "gpio pins",
      "gpio pin i2c 2>/dev/null || true",
      "gpio pin spi 2>/dev/null || true",
      "gpio pin uart 2>/dev/null || true",
      "gpio pin pwm 2>/dev/null || true",
      "set-device status 2>/dev/null || true",
      "sed -n '1,160p' /boot/config.txt 2>/dev/null || true",
    ].join("; "),
    reply: "我会只读检查引脚、总线和 overlay，避免误占用 GPIO。",
    timeoutMs: 20_000,
  },
  notes: {
    title: "今天笔记",
    risk: "read",
    mode: "remote",
    command: "walnut today",
    reply: "我会读取今天保存的核桃派笔记。",
    timeoutMs: 10_000,
  },
  note: {
    title: "记录笔记",
    risk: "write-low",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要记录的内容。");
      return `walnut note ${shellQuote(text)}`;
    },
    reply: "我会把这句话写进核桃派本地笔记。",
    timeoutMs: 10_000,
  },
  ai: {
    title: "WalnutAI Agent",
    risk: "read",
    mode: "remote",
    buildCommand(body) {
      const text = String(body.text || "").trim();
      if (!text) throw new Error("缺少要问 WalnutAI 的内容。");
      return `walnut ai ${shellQuote(text)}`;
    },
    reply: "我会把自然语言交给 WalnutAI，由它判断是否需要先执行本地安全动作。",
    timeoutMs: 120_000,
  },
  video: {
    title: "彩色视频",
    risk: "interactive",
    mode: "terminal",
    command: "walnut video color",
    reply: "我会直接运行彩色 ASCII 视频命令，不打开菜单。",
  },
};

function actionSummary(action, id) {
  return {
    id,
    title: action.title,
    risk: action.risk,
    mode: action.mode,
    reply: action.reply,
  };
}

async function handleAction(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求不是有效 JSON。" }, 400);
  }

  const id = String(body.action || "");
  const action = ACTIONS[id];
  if (!action) {
    return json({ ok: false, error: "未知或未允许的动作。" }, 400);
  }

  let command = action.command;
  try {
    if (action.buildCommand) command = action.buildCommand(body);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  if (action.mode === "terminal") {
    return json({
      ok: true,
      ...actionSummary(action, id),
      command,
    });
  }

  const result = await runRemote(command, action.timeoutMs);
  return json({
    ok: result.ok,
    ...actionSummary(action, id),
    command,
    code: result.code,
    output: result.output,
  });
}

function startSsh(ws) {
  const target = `${SSH_USER}@${SSH_HOST}`;
  const child = spawn(
    "sshpass",
    [
      "-e",
      "ssh",
      "-tt",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      target,
    ],
    {
      env: {
        ...process.env,
        SSHPASS: SSH_PASSWORD,
        TERM: "xterm-256color",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  ws.data.child = child;

  const send = (chunk) => {
    try {
      ws.send(chunk);
    } catch {
      child.kill("SIGTERM");
    }
  };

  send(`\r\n[local] ssh ${target}\r\n\r\n`);
  child.stdout.on("data", send);
  child.stderr.on("data", send);

  child.on("error", (error) => {
    send(`\r\n[local] ${error.message}\r\n`);
    ws.close();
  });

  child.on("close", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    send(`\r\n[local] session closed (${reason})\r\n`);
    ws.close();
  });
}

function stopSsh(ws) {
  const child = ws.data.child;
  if (!child || child.killed) return;

  child.stdin.end();
  child.kill("SIGTERM");

  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 1000).unref?.();
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/terminal") {
      if (previewOnly(url)) {
        return new Response("SSH disabled for preview", { status: 403 });
      }
      const upgraded = server.upgrade(req, { data: { child: null } });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/actions") {
      return json({
        target: `${SSH_USER}@${SSH_HOST}`,
        actions: Object.fromEntries(Object.entries(ACTIONS).map(([id, action]) => [id, actionSummary(action, id)])),
      });
    }

    if (url.pathname === "/api/screen/manifest") {
      return json(screenManifestEnvelope());
    }

    if (url.pathname === "/api/screen/sync") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleScreenSync(req);
    }

    const screenFrameMatch = url.pathname.match(/^\/api\/screen\/frame\/([^/]+)$/);
    if (screenFrameMatch) {
      if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      let buildId;
      try {
        buildId = decodeURIComponent(screenFrameMatch[1]);
      } catch {
        return json({ ok: false, error: "Invalid screen frame id" }, 400);
      }
      return handleScreenFrame(buildId);
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (previewOnly(url)) return previewOnlyJson();
      return handleAction(req);
    }

    const file = files.get(url.pathname);
    if (!file) {
      return new Response("Not found", { status: 404 });
    }

    const body = Bun.file(`${BASE_DIR}/${file}`);
    if (!(await body.exists())) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(body, {
      headers: {
        "content-type": contentType(file),
      },
    });
  },
  websocket: {
    open(ws) {
      startSsh(ws);
    },
    message(ws, message) {
      const child = ws.data.child;
      if (!child || child.killed || !child.stdin.writable) return;

      child.stdin.write(typeof message === "string" ? message : Buffer.from(message));
    },
    close(ws) {
      stopSsh(ws);
    },
  },
});

console.log(`Serving model terminal at http://${server.hostname}:${server.port}/`);
console.log(`Target: ${SSH_USER}@${SSH_HOST}`);
