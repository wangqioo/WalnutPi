import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, any>;

export function createLvglRuntimePreviewRenderer({
  projectRoot,
  screenWorkspaceRoot,
  previewOutputDir,
  runLocal,
  findWindowsCommand,
}: JsonObject) {
  const project = path.resolve(projectRoot);
  const workspace = path.resolve(screenWorkspaceRoot);
  const outputDir = path.resolve(previewOutputDir);

  async function renderRuntime({ runtimeIndexPath, stemPrefix, advanceMs }: JsonObject) {
    await mkdir(outputDir, { recursive: true });
    const build = await runPreviewBuild();
    if (!build.ok) throw previewError("LVGL preview build failed", { output: build.output });

    const exePath = previewExePath();
    if (!existsSync(exePath)) throw previewError("LVGL preview executable is missing", { output: exePath });

    const frames = [];
    for (const ms of advanceMs) {
      const stem = `${cleanStem(stemPrefix)}-${String(ms).padStart(5, "0")}ms`;
      const bmpPath = path.join(outputDir, `${stem}.bmp`);
      const pngPath = path.join(outputDir, `${stem}.png`);
      const rendered = await runLocal(exePath, [bmpPath, "--advance-ms", String(ms), "--runtime", runtimeIndexPath], {
        timeoutMs: 30_000,
        outputLimit: 12_000,
      });
      if (!rendered.ok) {
        throw previewError("LVGL preview render failed", {
          output: rendered.output,
          advanceMs: ms,
        });
      }
      await ensurePreviewPng(bmpPath, pngPath);
      frames.push({
        advanceMs: ms,
        bmp: workspaceAssetUrl(bmpPath),
        png: workspaceAssetUrl(pngPath),
      });
    }
    return { frames, buildOutput: build.output };
  }

  async function renderDemo({ demo, stem }: JsonObject) {
    await mkdir(outputDir, { recursive: true });
    const build = await runPreviewBuild();
    if (!build.ok) throw previewError("LVGL preview build failed", { output: build.output });

    const exePath = previewExePath();
    if (!existsSync(exePath)) throw previewError("LVGL preview executable is missing", { output: exePath });

    const bmpPath = path.join(outputDir, `${cleanStem(stem || demo)}.bmp`);
    const pngPath = path.join(outputDir, `${cleanStem(stem || demo)}.png`);
    const rendered = await runLocal(exePath, [bmpPath, "--demo", demo, "--advance-ms", "1800"], {
      timeoutMs: 30_000,
      outputLimit: 12_000,
    });
    if (!rendered.ok) throw previewError("LVGL demo preview failed", { output: rendered.output });
    await ensurePreviewPng(bmpPath, pngPath);
    return {
      bmp: workspaceAssetUrl(bmpPath),
      bmpPath,
      png: workspaceAssetUrl(pngPath),
      pngPath,
    };
  }

  function previewExePath() {
    return process.platform === "win32"
      ? path.join(project, "build", "lvgl_app-windows", "walnut-lvgl-preview.exe")
      : path.join(project, "build", "lvgl_app", "walnut-lvgl-preview");
  }

  async function runPreviewBuild() {
    if (process.platform === "win32") {
      const pwsh = findWindowsCommand("pwsh.exe") || findWindowsCommand("powershell.exe") || "pwsh";
      return runLocal(pwsh, ["./scripts/build-lvgl-app.ps1", "-WorkspaceLvgl", "1"], {
        timeoutMs: 120_000,
        outputLimit: 24_000,
      });
    }
    return runLocal("bash", ["./scripts/build-lvgl-app.sh"], {
      timeoutMs: 120_000,
      outputLimit: 24_000,
    });
  }

  async function ensurePreviewPng(bmpPath: string, pngPath: string) {
    if (process.platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Drawing",
        `$bmp = [System.Drawing.Image]::FromFile('${escapePowershellSingleQuoted(bmpPath)}')`,
        "try {",
        `  $bmp.Save('${escapePowershellSingleQuoted(pngPath)}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        "} finally {",
        "  $bmp.Dispose()",
        "}",
      ].join("\n");
      const pwsh = findWindowsCommand("pwsh.exe") || findWindowsCommand("powershell.exe") || "pwsh";
      const converted = await runLocal(pwsh, ["-NoProfile", "-Command", script], {
        timeoutMs: 30_000,
        outputLimit: 8_000,
      });
      if (!converted.ok) throw new Error(`LVGL preview PNG conversion failed: ${converted.output}`);
      return;
    }
    await copyFile(bmpPath, pngPath);
  }

  function workspaceAssetUrl(filePath: string) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(workspace, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("LVGL preview output must stay inside the Screen Workspace");
    }
    return `/api/screen/workspace/assets/${encodeURIComponent(relative.replaceAll("\\", "/"))}`;
  }

  return { renderRuntime, renderDemo };
}

function cleanStem(value: any) {
  return String(value || "lvgl").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 96) || "lvgl";
}

function escapePowershellSingleQuoted(value: string) {
  return String(value).replace(/'/g, "''");
}

function previewError(message: string, details: JsonObject) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}
