import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function createWalnutRemoteAdapter({
  sshHost,
  sshUser,
  sshPassword,
  remoteProjectRoot,
  walnutCliSourcePath,
  outputLimit,
  captureOutputLimit,
  sha256,
  limitedOutput,
  controlMasterEnabled = process.platform !== "win32",
  controlDir = path.join(tmpdir(), `walnutpi-web-ssh-${process.getuid?.() || "user"}`),
}) {
  let walnutCliEnsurePromise = null;
  let walnutCliEnsureHash = null;

  function target() {
    return `${sshUser}@${sshHost}`;
  }

  function connectionOptions() {
    const options = [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
    ];
    if (controlMasterEnabled) {
      mkdirSync(controlDir, { recursive: true, mode: 0o700 });
      options.push(
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPersist=600",
        "-o",
        `ControlPath=${path.join(controlDir, "%C")}`,
      );
    }
    return options;
  }

  function sshEnv(extra = {}) {
    return {
      ...process.env,
      SSHPASS: sshPassword,
      TERM: "xterm-256color",
      ...extra,
    };
  }

  function runRaw(command, timeoutMs = 15_000, limit = outputLimit) {
    return new Promise((resolve) => {
      const child = spawn(
        "sshpass",
        [
          "-e",
          "ssh",
          "-T",
          ...connectionOptions(),
          "-o",
          "ConnectTimeout=8",
          "-o",
          "ConnectionAttempts=1",
          target(),
          `sh -lc ${shellQuote(command)}`,
        ],
        {
          env: sshEnv(),
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
          output: limitedOutput(`${stdout}${stderr}\n[local] action timed out`.trim(), limit),
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
        const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok", limit);
        resolve({ ok: code === 0, code, output });
      });
    });
  }

  function runRawScript(script, timeoutMs = 15_000, limit = outputLimit) {
    return new Promise((resolve) => {
      const child = spawn(
        "sshpass",
        [
          "-e",
          "ssh",
          "-T",
          ...connectionOptions(),
          "-o",
          "ConnectTimeout=8",
          "-o",
          "ConnectionAttempts=1",
          target(),
          "sh",
        ],
        {
          env: sshEnv({ SSHPASS: sshPassword }),
          stdio: ["pipe", "pipe", "pipe"],
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
          output: limitedOutput(`${stdout}${stderr}\n[local] remote script timed out after ${timeoutMs}ms`.trim(), limit),
        });
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.stdin.on("error", () => {});
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
        const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok", limit);
        resolve({ ok: code === 0, code, output });
      });
      child.stdin.end(String(script || "").replace(/\r\n/g, "\n"));
    });
  }

  function runRawWithInput(command, input, timeoutMs = 15_000, limit = outputLimit) {
    return new Promise((resolve) => {
      const child = spawn(
        "sshpass",
        [
          "-e",
          "ssh",
          "-T",
          ...connectionOptions(),
          "-o",
          "ConnectTimeout=8",
          "-o",
          "ConnectionAttempts=1",
          target(),
          `sh -lc ${shellQuote(command)}`,
        ],
        {
          env: sshEnv({ SSHPASS: sshPassword }),
          stdio: ["pipe", "pipe", "pipe"],
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
          output: limitedOutput(`${stdout}${stderr}\n[local] remote input command timed out after ${timeoutMs}ms`.trim(), limit),
        });
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.stdin.on("error", () => {});
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
        const output = limitedOutput(`${stdout}${stderr}`.trim() || "ok", limit);
        resolve({ ok: code === 0, code, output });
      });
      child.stdin.end(Buffer.isBuffer(input) ? input : Buffer.from(input || ""));
    });
  }

  async function localWalnutCliHash() {
    const source = await readFile(walnutCliSourcePath, "utf8");
    return sha256(source.replace(/\r\n/g, "\n"));
  }

  function walnutCliInstallScript({ expectedHash, content }) {
    const base64 = Buffer.from(String(content || "").replace(/\r\n/g, "\n"), "utf8").toString("base64");
    return [
      "set -e",
      `EXPECTED=${shellQuote(expectedHash)}`,
      `ROOT=${shellQuote(remoteProjectRoot)}`,
      "REMOTE=$(command -v walnut 2>/dev/null || true)",
      "REMOTE_HASH=",
      'if [ -n "$REMOTE" ] && [ -f "$REMOTE" ]; then REMOTE_HASH=$(sha256sum "$REMOTE" | awk \'{print $1}\'); fi',
      'if [ "$REMOTE_HASH" = "$EXPECTED" ]; then',
      '  printf "walnut cli ok: %s\\n" "$REMOTE_HASH"',
      "  exit 0",
      "fi",
      'install -d "$ROOT/walnut-assistant"',
      "base64 -d > \"$ROOT/walnut-assistant/walnut\" <<'WALNUT_CLI_FILE'",
      base64,
      "WALNUT_CLI_FILE",
      'chmod 0755 "$ROOT/walnut-assistant/walnut"',
      'if command -v sudo >/dev/null 2>&1; then sudo -n install -m 0755 "$ROOT/walnut-assistant/walnut" /usr/local/bin/walnut; else install -m 0755 "$ROOT/walnut-assistant/walnut" /usr/local/bin/walnut; fi',
      'INSTALLED_HASH=$(sha256sum /usr/local/bin/walnut | awk \'{print $1}\')',
      'if [ "$INSTALLED_HASH" != "$EXPECTED" ]; then',
      '  printf "walnut cli install hash mismatch: expected=%s installed=%s\\n" "$EXPECTED" "$INSTALLED_HASH" >&2',
      "  exit 1",
      "fi",
      'printf "walnut cli installed: %s -> /usr/local/bin/walnut\\n" "$INSTALLED_HASH"',
    ].join("\n");
  }

  async function ensureWalnutCli({ force = false } = {}) {
    const expectedHash = await localWalnutCliHash();
    if (!force && walnutCliEnsureHash === expectedHash) {
      return { ok: true, code: 0, output: `walnut cli ok: ${expectedHash}`, ensured: false };
    }
    if (!force && walnutCliEnsurePromise) return walnutCliEnsurePromise;

    walnutCliEnsurePromise = (async () => {
      const content = await readFile(walnutCliSourcePath, "utf8");
      const result = await runRawScript(
        walnutCliInstallScript({ expectedHash, content }),
        20_000,
        outputLimit,
      );
      if (result.ok) walnutCliEnsureHash = expectedHash;
      return {
        ...result,
        ensured: result.ok && /installed/.test(result.output),
        expectedHash,
      };
    })();

    try {
      return await walnutCliEnsurePromise;
    } finally {
      walnutCliEnsurePromise = null;
    }
  }

  async function run(command, timeoutMs = 15_000, limit = outputLimit) {
    const ensure = await ensureWalnutCli();
    if (!ensure.ok) {
      return {
        ok: false,
        code: ensure.code,
        output: limitedOutput(
          [
            "[walnut cli preflight failed]",
            ensure.output,
            "",
            "[command skipped]",
            command,
          ].join("\n"),
          limit,
        ),
      };
    }
    const result = await runRaw(command, timeoutMs, limit);
    if (ensure.ensured) {
      return { ...result, preflightOutput: ensure.output };
    }
    return result;
  }

  async function runScript(script, timeoutMs = 15_000, limit = outputLimit) {
    const ensure = await ensureWalnutCli();
    if (!ensure.ok) {
      return {
        ok: false,
        code: ensure.code,
        output: limitedOutput(
          [
            "[walnut cli preflight failed]",
            ensure.output,
            "",
            "[remote script skipped]",
          ].join("\n"),
          limit,
        ),
      };
    }
    const result = await runRawScript(script, timeoutMs, limit);
    if (ensure.ensured) {
      return { ...result, preflightOutput: ensure.output };
    }
    return result;
  }

  async function runWithInput(command, input, timeoutMs = 15_000, limit = outputLimit) {
    const ensure = await ensureWalnutCli();
    if (!ensure.ok) {
      return {
        ok: false,
        code: ensure.code,
        output: limitedOutput(
          [
            "[walnut cli preflight failed]",
            ensure.output,
            "",
            "[remote input command skipped]",
          ].join("\n"),
          limit,
        ),
      };
    }
    const result = await runRawWithInput(command, input, timeoutMs, limit);
    if (ensure.ensured) {
      return { ...result, preflightOutput: ensure.output };
    }
    return result;
  }

  async function capturePngBase64() {
    return run("sudo -n walnut screen capture --png-base64", 30_000, captureOutputLimit);
  }

  function openInteractiveSession() {
    return spawn(
      "sshpass",
      [
        "-e",
        "ssh",
        "-tt",
        ...connectionOptions(),
        target(),
      ],
      {
        env: sshEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  }

  return {
    target,
    connectionOptions,
    ensureWalnutCli,
    run,
    runScript,
    runWithInput,
    capturePngBase64,
    openInteractiveSession,
  };
}
