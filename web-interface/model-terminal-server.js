import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const SSH_HOST = process.env.SSH_HOST || "192.168.1.30";
const SSH_USER = process.env.SSH_USER || "root";
const SSH_PASSWORD = process.env.SSH_PASSWORD || "root";
const BASE_DIR = import.meta.dir;
const MODEL_FILE = "0c6390ea8b1ccf186ec099456954fd42.glb";
const ACTION_OUTPUT_LIMIT = 24_000;

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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function limitedOutput(value) {
  if (value.length <= ACTION_OUTPUT_LIMIT) return value;
  return `${value.slice(0, ACTION_OUTPUT_LIMIT)}\n\n[local] output truncated`;
}

function runRemote(command, timeoutMs = 15_000) {
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
        output: limitedOutput(`${stdout}${stderr}\n[local] action timed out`.trim()),
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
      const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok");
      resolve({ ok: code === 0, code, output });
    });
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
  const sshCommand = [
    "sshpass -e",
    "ssh",
    "-tt",
    "-o StrictHostKeyChecking=no",
    "-o UserKnownHostsFile=/dev/null",
    "-o LogLevel=ERROR",
    target,
  ].join(" ");

  const child = spawn("script", ["-qfec", sshCommand, "/dev/null"], {
    env: {
      ...process.env,
      SSHPASS: SSH_PASSWORD,
      TERM: "xterm-256color",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

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
      const upgraded = server.upgrade(req, { data: { child: null } });
      return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/actions") {
      return json({
        target: `${SSH_USER}@${SSH_HOST}`,
        actions: Object.fromEntries(Object.entries(ACTIONS).map(([id, action]) => [id, actionSummary(action, id)])),
      });
    }

    if (url.pathname === "/api/action") {
      if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
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
