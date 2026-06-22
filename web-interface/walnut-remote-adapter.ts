import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Client as SshClient } from "ssh2";

type RemoteRunResult = Record<string, any> & {
  code: number | null;
  ok: boolean;
  output: string;
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function createWalnutRemoteAdapter({
  sshHost,
  sshUser,
  sshPassword,
  remoteProjectRoot,
  walnutCliSourcePath,
  actionPolicyManifestPath,
  outputLimit,
  captureOutputLimit,
  sha256,
  limitedOutput,
}) {
  let walnutCliEnsurePromise: Promise<RemoteRunResult & Record<string, any>> | null = null;
  let walnutCliEnsureHash = null;
  let pooledClient = null;
  let pooledClientPromise = null;

  function elapsedSince(startedAt) {
    return Date.now() - startedAt;
  }

  function target() {
    return `${sshUser}@${sshHost}`;
  }

  function sshEnv(extra = {}) {
    return {
      ...process.env,
      SSHPASS: sshPassword,
      TERM: "xterm-256color",
      ...extra,
    };
  }

  function closePooledClient() {
    if (pooledClient) {
      try {
        pooledClient.end();
      } catch {}
    }
    pooledClient = null;
    pooledClientPromise = null;
  }

  function getPooledClient(timeoutMs = 15_000) {
    if (pooledClient) return Promise.resolve(pooledClient);
    if (pooledClientPromise) return pooledClientPromise;

    pooledClientPromise = new Promise((resolve, reject) => {
      const client = new SshClient();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          client.end();
        } catch {}
        reject(new Error(`ssh2 connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (pooledClient === client) pooledClient = null;
        if (pooledClientPromise) pooledClientPromise = null;
        reject(error);
      };

      const forgetClient = () => {
        if (pooledClient === client) pooledClient = null;
        if (pooledClientPromise) pooledClientPromise = null;
      };

      client
        .once("ready", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pooledClient = client;
          pooledClientPromise = null;
          resolve(client);
        })
        .once("error", fail)
        .once("end", forgetClient)
        .once("close", forgetClient)
        .connect({
          host: sshHost,
          port: 22,
          username: sshUser,
          password: sshPassword,
          readyTimeout: Math.min(timeoutMs, 8_000),
          keepaliveInterval: 15_000,
          keepaliveCountMax: 3,
        });
    });

    return pooledClientPromise;
  }

  function ssh2FailureResult(error, reusedConnection, messagePrefix = "ssh2") {
    closePooledClient();
    return {
      ok: false,
      code: null,
      output: `[local] ${messagePrefix}: ${error.message}`,
      reusedConnection,
      remoteTransport: "ssh2",
    };
  }

  function remoteConnectionFields(result: RemoteRunResult | null | undefined) {
    return {
      remoteTransport: result?.remoteTransport || null,
      reusedConnection: typeof result?.reusedConnection === "boolean" ? result.reusedConnection : null,
    };
  }

  async function runRawPooled(command, timeoutMs = 15_000, limit = outputLimit): Promise<RemoteRunResult> {
    let client;
    try {
      client = await getPooledClient(timeoutMs);
    } catch (error) {
      return ssh2FailureResult(error, false, "ssh2 connection failed");
    }

    return new Promise<RemoteRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        closePooledClient();
        finish({
          ok: false,
          code: null,
          output: limitedOutput(`${stdout}${stderr}\n[local] ssh2 command timed out after ${timeoutMs}ms`.trim(), limit),
          reusedConnection: true,
          remoteTransport: "ssh2",
        });
      }, timeoutMs);

      const fail = (error) => finish(ssh2FailureResult(error, true, "ssh2 connection failed"));
      client.once("error", fail);
      client.once("close", () => {
        finish({
          ok: false,
          code: null,
          output: limitedOutput(`${stdout}${stderr}\n[local] ssh2 connection closed before command completed`.trim(), limit),
          reusedConnection: true,
          remoteTransport: "ssh2",
        });
      });

      client.exec(`sh -lc ${shellQuote(command)}`, { env: { TERM: "xterm-256color" } }, (error, stream) => {
        if (error) {
          finish(ssh2FailureResult(error, true, "ssh2 exec failed"));
          return;
        }

        stream
          .on("close", (code) => {
            client.off("error", fail);
            finish({
              ok: code === 0,
              code,
              output: limitedOutput(`${stdout}${stderr}`.trim() || "ok", limit),
              reusedConnection: true,
              remoteTransport: "ssh2",
            });
          })
          .on("data", (chunk) => {
            stdout += chunk.toString("utf8");
          });
        stream.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });
      });
    });
  }

  async function runRawScriptPooled(script, timeoutMs = 15_000, limit = outputLimit) {
    let client;
    try {
      client = await getPooledClient(timeoutMs);
    } catch (error) {
      return ssh2FailureResult(error, false, "ssh2 connection failed");
    }

    return new Promise<RemoteRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        closePooledClient();
        finish({
          ok: false,
          code: null,
          output: limitedOutput(`${stdout}${stderr}\n[local] ssh2 script timed out after ${timeoutMs}ms`.trim(), limit),
          reusedConnection: true,
          remoteTransport: "ssh2",
        });
      }, timeoutMs);

      const fail = (error) => finish(ssh2FailureResult(error, true, "ssh2 connection failed"));
      client.once("error", fail);
      client.once("close", () => {
        finish({
          ok: false,
          code: null,
          output: limitedOutput(`${stdout}${stderr}\n[local] ssh2 connection closed before script completed`.trim(), limit),
          reusedConnection: true,
          remoteTransport: "ssh2",
        });
      });

      client.exec("sh", { env: { TERM: "xterm-256color" } }, (error, stream) => {
        if (error) {
          finish(ssh2FailureResult(error, true, "ssh2 exec failed"));
          return;
        }

        stream
          .on("close", (code) => {
            client.off("error", fail);
            finish({
              ok: code === 0,
              code,
              output: limitedOutput(`${stdout}${stderr}`.trim() || "ok", limit),
              reusedConnection: true,
              remoteTransport: "ssh2",
            });
          })
          .on("data", (chunk) => {
            stdout += chunk.toString("utf8");
          });
        stream.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });
        stream.end(String(script || "").replace(/\r\n/g, "\n"));
      });
    });
  }

  async function runRawWithInputPooled(command, input, timeoutMs = 15_000, limit = outputLimit) {
    let client;
    try {
      client = await getPooledClient(timeoutMs);
    } catch (error) {
      return ssh2FailureResult(error, false, "ssh2 connection failed");
    }

    return new Promise<RemoteRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        closePooledClient();
        finish({
          ok: false,
          code: null,
          output: limitedOutput(`${stdout}${stderr}\n[local] ssh2 input command timed out after ${timeoutMs}ms`.trim(), limit),
          reusedConnection: true,
          remoteTransport: "ssh2",
        });
      }, timeoutMs);

      const fail = (error) => finish(ssh2FailureResult(error, true, "ssh2 connection failed"));
      client.once("error", fail);
      client.once("close", () => {
        finish({
          ok: false,
          code: null,
          output: limitedOutput(`${stdout}${stderr}\n[local] ssh2 connection closed before input command completed`.trim(), limit),
          reusedConnection: true,
          remoteTransport: "ssh2",
        });
      });

      client.exec(`sh -lc ${shellQuote(command)}`, { env: { TERM: "xterm-256color" } }, (error, stream) => {
        if (error) {
          finish(ssh2FailureResult(error, true, "ssh2 exec failed"));
          return;
        }

        stream
          .on("close", (code) => {
            client.off("error", fail);
            finish({
              ok: code === 0,
              code,
              output: limitedOutput(`${stdout}${stderr}`.trim() || "ok", limit),
              reusedConnection: true,
              remoteTransport: "ssh2",
            });
          })
          .on("data", (chunk) => {
            stdout += chunk.toString("utf8");
          });
        stream.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });
        stream.end(Buffer.isBuffer(input) ? input : Buffer.from(input || ""));
      });
    });
  }

  function runRaw(command, timeoutMs = 15_000, limit = outputLimit): Promise<RemoteRunResult> {
    return runRawPooled(command, timeoutMs, limit);
  }

  async function localWalnutCliBundle() {
    const cli = (await readFile(walnutCliSourcePath, "utf8")).replace(/\r\n/g, "\n");
    const manifest = (await readFile(actionPolicyManifestPath, "utf8")).replace(/\r\n/g, "\n");
    return {
      cli,
      manifest,
      hash: sha256(`${cli}\n--ACTION-POLICY-MANIFEST--\n${manifest}`),
      cliHash: sha256(cli),
      manifestHash: sha256(manifest),
    };
  }

  function runRawScript(script, timeoutMs = 15_000, limit = outputLimit): Promise<RemoteRunResult> {
    return runRawScriptPooled(script, timeoutMs, limit);
  }

  function runRawWithInput(command, input, timeoutMs = 15_000, limit = outputLimit): Promise<RemoteRunResult> {
    return runRawWithInputPooled(command, input, timeoutMs, limit);
  }

  function walnutCliInstallScript({ bundle }) {
    const cliBase64 = Buffer.from(bundle.cli, "utf8").toString("base64");
    const manifestBase64 = Buffer.from(bundle.manifest, "utf8").toString("base64");
    return [
      "set -e",
      `EXPECTED_CLI=${shellQuote(bundle.cliHash)}`,
      `EXPECTED_MANIFEST=${shellQuote(bundle.manifestHash)}`,
      `ROOT=${shellQuote(remoteProjectRoot)}`,
      "REMOTE=$(command -v walnut 2>/dev/null || true)",
      "REMOTE_CLI_HASH=",
      "REMOTE_MANIFEST_HASH=",
      'if [ -n "$REMOTE" ] && [ -f "$REMOTE" ]; then REMOTE_CLI_HASH=$(sha256sum "$REMOTE" | awk \'{print $1}\'); fi',
      'if [ -f "$ROOT/action-policy-manifest.json" ]; then REMOTE_MANIFEST_HASH=$(sha256sum "$ROOT/action-policy-manifest.json" | awk \'{print $1}\'); fi',
      'if [ "$REMOTE_CLI_HASH" = "$EXPECTED_CLI" ] && [ "$REMOTE_MANIFEST_HASH" = "$EXPECTED_MANIFEST" ]; then',
      '  printf "walnut cli ok: %s\\naction policy manifest ok: %s\\n" "$REMOTE_CLI_HASH" "$REMOTE_MANIFEST_HASH"',
      "  exit 0",
      "fi",
      'install -d "$ROOT/walnut-assistant"',
      "base64 -d > \"$ROOT/walnut-assistant/walnut\" <<'WALNUT_CLI_FILE'",
      cliBase64,
      "WALNUT_CLI_FILE",
      "base64 -d > \"$ROOT/action-policy-manifest.json\" <<'WALNUT_ACTION_POLICY_FILE'",
      manifestBase64,
      "WALNUT_ACTION_POLICY_FILE",
      'chmod 0755 "$ROOT/walnut-assistant/walnut"',
      'if command -v sudo >/dev/null 2>&1; then sudo -n install -m 0755 "$ROOT/walnut-assistant/walnut" /usr/local/bin/walnut; else install -m 0755 "$ROOT/walnut-assistant/walnut" /usr/local/bin/walnut; fi',
      'INSTALLED_HASH=$(sha256sum /usr/local/bin/walnut | awk \'{print $1}\')',
      'INSTALLED_MANIFEST_HASH=$(sha256sum "$ROOT/action-policy-manifest.json" | awk \'{print $1}\')',
      'if [ "$INSTALLED_HASH" != "$EXPECTED_CLI" ]; then',
      '  printf "walnut cli install hash mismatch: expected=%s installed=%s\\n" "$EXPECTED_CLI" "$INSTALLED_HASH" >&2',
      "  exit 1",
      "fi",
      'if [ "$INSTALLED_MANIFEST_HASH" != "$EXPECTED_MANIFEST" ]; then',
      '  printf "action policy manifest install hash mismatch: expected=%s installed=%s\\n" "$EXPECTED_MANIFEST" "$INSTALLED_MANIFEST_HASH" >&2',
      "  exit 1",
      "fi",
      'printf "walnut cli installed: %s -> /usr/local/bin/walnut\\n" "$INSTALLED_HASH"',
      'printf "action policy manifest installed: %s -> $ROOT/action-policy-manifest.json\\n" "$INSTALLED_MANIFEST_HASH"',
    ].join("\n");
  }

  async function ensureWalnutCli({ force = false } = {}) {
    const bundle = await localWalnutCliBundle();
    if (!force && walnutCliEnsureHash === bundle.hash) {
      return { ok: true, code: 0, output: `walnut cli ok: ${bundle.cliHash}\naction policy manifest ok: ${bundle.manifestHash}`, ensured: false };
    }
    if (!force && walnutCliEnsurePromise) return walnutCliEnsurePromise;

    walnutCliEnsurePromise = (async () => {
      const result = await runRawScript(
        walnutCliInstallScript({ bundle }),
        20_000,
        outputLimit,
      );
      if (result.ok) walnutCliEnsureHash = bundle.hash;
      return {
        ...result,
        ensured: result.ok && /installed/.test(result.output),
        expectedHash: bundle.hash,
        cliHash: bundle.cliHash,
        manifestHash: bundle.manifestHash,
      };
    })();

    try {
      return await walnutCliEnsurePromise;
    } finally {
      walnutCliEnsurePromise = null;
    }
  }

  async function run(command, timeoutMs = 15_000, limit = outputLimit) {
    const preflightStartedAt = Date.now();
    const ensure = await ensureWalnutCli();
    const preflightMs = elapsedSince(preflightStartedAt);
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
        preflightMs,
        preflightEnsured: ensure.ensured,
        ...remoteConnectionFields(ensure),
      };
    }
    const remoteStartedAt = Date.now();
    const result = await runRaw(command, timeoutMs, limit);
    const remoteMs = elapsedSince(remoteStartedAt);
    const timings = {
      preflightMs,
      remoteMs,
      preflightEnsured: ensure.ensured,
    };
    if (ensure.ensured) {
      return { ...result, ...timings, preflightOutput: ensure.output };
    }
    return { ...result, ...timings };
  }

  async function runScript(script, timeoutMs = 15_000, limit = outputLimit) {
    const preflightStartedAt = Date.now();
    const ensure = await ensureWalnutCli();
    const preflightMs = elapsedSince(preflightStartedAt);
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
        preflightMs,
        preflightEnsured: ensure.ensured,
        ...remoteConnectionFields(ensure),
      };
    }
    const remoteStartedAt = Date.now();
    const result = await runRawScript(script, timeoutMs, limit);
    const remoteMs = elapsedSince(remoteStartedAt);
    const timings = {
      preflightMs,
      remoteMs,
      preflightEnsured: ensure.ensured,
    };
    if (ensure.ensured) {
      return { ...result, ...timings, preflightOutput: ensure.output };
    }
    return { ...result, ...timings };
  }

  async function runWithInput(command, input, timeoutMs = 15_000, limit = outputLimit) {
    const preflightStartedAt = Date.now();
    const ensure = await ensureWalnutCli();
    const preflightMs = elapsedSince(preflightStartedAt);
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
        preflightMs,
        preflightEnsured: ensure.ensured,
        ...remoteConnectionFields(ensure),
      };
    }
    const remoteStartedAt = Date.now();
    const result = await runRawWithInput(command, input, timeoutMs, limit);
    const remoteMs = elapsedSince(remoteStartedAt);
    const timings = {
      preflightMs,
      remoteMs,
      preflightEnsured: ensure.ensured,
    };
    if (ensure.ensured) {
      return { ...result, ...timings, preflightOutput: ensure.output };
    }
    return { ...result, ...timings };
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
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
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
    ensureWalnutCli,
    runRaw,
    runRawScript,
    runRawWithInput,
    run,
    runScript,
    runWithInput,
    capturePngBase64,
    openInteractiveSession,
    closePooledClient,
  };
}
