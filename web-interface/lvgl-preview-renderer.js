import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function previewHeaders(manifestHash, cacheState = null) {
  const headers = {
    "content-type": "image/bmp",
    "cache-control": "no-store",
    "x-walnut-screen-manifest-hash": manifestHash,
    "x-walnut-preview-renderer": "lvgl-offscreen",
  };
  if (cacheState) headers["x-walnut-preview-cache"] = cacheState;
  return headers;
}

export function createLvglPreviewRenderer({
  projectRoot,
  timeoutMs,
  readManifestEnvelope,
  runLocal,
  shellQuote,
  bashPath,
  json,
}) {
  return async function handleLvglPreview(url) {
    const envelope = await readManifestEnvelope();
    const expectedHash = (url.searchParams.get("manifestHash") || "").trim();
    if (expectedHash && expectedHash !== envelope.manifestHash) {
      return json(
        {
          ok: false,
          error: "stale manifestHash",
          summary: "Web LVGL 预览请求使用了过期 manifestHash，请刷新 manifest 后重试。",
          manifestHash: envelope.manifestHash,
        },
        409,
      );
    }

    const previewDir = path.join(tmpdir(), "walnutpi-lvgl-preview");
    const previewPath = path.join(previewDir, `${envelope.manifestHash}.bmp`);
    await mkdir(previewDir, { recursive: true });
    const cachedBody = Bun.file(previewPath);
    if (await cachedBody.exists()) {
      return new Response(cachedBody, {
        headers: previewHeaders(envelope.manifestHash, "hit"),
      });
    }

    const output = await runLocal(
      "bash",
      [
        "-lc",
        [
          `cd ${shellQuote(bashPath(projectRoot))}`,
          "./scripts/build-lvgl-app.sh >/dev/null",
          `./build/lvgl_app/walnut-lvgl-preview ${shellQuote(bashPath(previewPath))}`,
        ].join(" && "),
      ],
      {
        timeoutMs,
        outputLimit: 12_000,
      },
    );
    if (!output.ok) {
      return json(
        {
          ok: false,
          error: "lvgl preview render failed",
          summary: "本地 LVGL 预览渲染失败。",
          output: output.output,
          manifestHash: envelope.manifestHash,
        },
        500,
      );
    }

    const body = Bun.file(previewPath);
    if (!(await body.exists())) {
      return json(
        {
          ok: false,
          error: "lvgl preview image missing",
          summary: "LVGL 预览命令成功，但没有产出 BMP。",
          output: output.output,
          manifestHash: envelope.manifestHash,
        },
        500,
      );
    }

    return new Response(body, {
      headers: previewHeaders(envelope.manifestHash),
    });
  };
}
