import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  normalizeScreenManifest,
  stableStringify,
} from "../scripts/screen-manifest-vocabulary.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonFile(filePath, value) {
  await writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true });
  await rename(`${filePath}.tmp`, filePath);
}

export function createScreenManifestStore({
  manifestPath,
  validSha256,
}) {
  async function envelope() {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`failed to read screen manifest ${manifestPath}: ${error.message}`);
    }
    manifest = normalizeScreenManifest(manifest);
    const serializedManifest = stableStringify(manifest);
    return {
      manifest,
      manifestHash: sha256(serializedManifest),
    };
  }

  async function write(manifest) {
    const normalized = normalizeScreenManifest(manifest);
    await writeJsonFile(manifestPath, normalized);
    return envelope();
  }

  async function currentForWrite(body) {
    let current;
    try {
      current = await envelope();
    } catch (error) {
      return {
        ok: false,
        status: 500,
        response: {
          ok: false,
          error: "screen manifest invalid",
          summary: "screen manifest 无法读取或格式无效，请先修复小屏 contract。",
          output: error.message,
        },
      };
    }

    const clientHash = typeof body.manifestHash === "string" ? body.manifestHash : "";
    if (!validSha256(clientHash)) {
      return {
        ok: false,
        status: 400,
        response: {
          ok: false,
          error: "invalid manifestHash",
          summary: clientHash
            ? "同步请求包含无效的 screen manifest hash，请刷新页面后再试。"
            : "同步请求缺少 screen manifest hash，请刷新页面后再试。",
          manifestHash: current.manifestHash,
        },
      };
    }
    if (clientHash !== current.manifestHash) {
      return {
        ok: false,
        status: 409,
        response: {
          ok: false,
          error: "stale manifestHash",
          summary: "Web 预览和服务器 screen manifest 不一致，请刷新后再试。",
          manifestHash: current.manifestHash,
        },
      };
    }

    return {
      ok: true,
      ...current,
    };
  }

  return {
    envelope,
    write,
    currentForWrite,
  };
}
