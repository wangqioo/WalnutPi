import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function createScreenEvidenceLedger({
  recordsDir,
  recordLimit = 50,
  outputLimit = 24_000,
  buildRepairHint,
}) {
  function safeRecordId(value) {
    const text = String(value || "");
    if (!/^[a-zA-Z0-9._-]+$/.test(text) || text.includes("..") || text === "." || text.startsWith(".")) return null;
    return text;
  }

  function recordDir(buildId) {
    const id = safeRecordId(buildId);
    if (!id) return null;
    return path.join(recordsDir, id);
  }

  function frameUrl(buildId) {
    return `/api/screen/records/${encodeURIComponent(buildId)}/frame.png`;
  }

  function compactCommandResult(result) {
    return {
      ok: Boolean(result?.ok),
      code: result?.code ?? null,
      output: limitedOutput(String(result?.output || ""), 12_000),
    };
  }

  function summary(record) {
    return {
      schema: "walnutpi.screenSyncRecordSummary.v1",
      buildId: record.buildId,
      ok: record.ok,
      title: record.title,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      failedStage: record.failedStage,
      summary: record.summary,
      playlistHash: record.playlistHash,
      manifestHash: record.manifestHash,
      artifactHash: record.artifactHash,
      deliveryHash: record.deliveryHash,
      visualMatch: record.screenEvidence?.visualMatch || "unknown",
      frameHash: record.screenEvidence?.frame?.sha256 || null,
      frameContentEvidenceStatus: record.screenEvidence?.frameContentEvidence?.status || null,
      frameContentEvidenceClaim: record.screenEvidence?.frameContentEvidence?.claim || null,
      frameSampleHash: record.screenEvidence?.frameContentEvidence?.sampleHash || null,
      webDeviceFrameDiffSchema: record.webDeviceFrameDiff?.schema || null,
      webDeviceFrameDiffStatus: record.webDeviceFrameDiff?.status || null,
      webDeviceFrameDiffRatio: record.webDeviceFrameDiff?.diffRatio ?? null,
      webDeviceFrameDiffSource: record.webDeviceFrameDiff?.source || null,
      webDeviceFrameDiffWidth: record.webDeviceFrameDiff?.width ?? null,
      webDeviceFrameDiffHeight: record.webDeviceFrameDiff?.height ?? null,
      webDeviceFrameDiffComparedFrames: record.webDeviceFrameDiff?.comparedFrameUnits ?? null,
      previewSignatureHash: record.screenEvidence?.semantic?.previewSignatureHash || null,
      deviceSignatureHash: record.screenEvidence?.semantic?.deviceSignatureHash || null,
      hasFramePng: Boolean(record.framePng),
      frameUrl: record.framePng ? frameUrl(record.buildId) : null,
      repairHint: record.repairHint
        ? {
            stage: record.repairHint.stage,
            title: record.repairHint.title,
            summary: record.repairHint.summary,
            autoRepairAvailable: record.repairHint.autoRepairAvailable,
          }
        : null,
    };
  }

  function buildRecord(result, commandResults = {}) {
    const record: Record<string, any> = {
      schema: "walnutpi.screenSyncRecord.v1",
      buildId: result.buildId,
      title: result.title || "同步到核桃派",
      ok: Boolean(result.ok),
      risk: result.risk || "write-low",
      mode: result.mode || "remote",
      startedAt: result.startedAt,
      finishedAt: new Date().toISOString(),
      failedStage: result.failedStage || null,
      summary: result.summary,
      playlist: result.playlist || null,
      playlistHash: result.playlistHash || null,
      manifest: result.manifest || null,
      manifestHash: result.manifestHash || null,
      deliveryManifest: result.deliveryManifest || null,
      deliveryHash: result.deliveryHash || null,
      artifactHash: result.artifactHash || null,
      screenEvidence: result.screenEvidence || result.evidence || null,
      command: result.command || null,
      commandResults: Object.fromEntries(
        Object.entries(commandResults).map(([name, value]) => [name, compactCommandResult(value)]),
      ),
      output: limitedOutput(String(result.output || ""), outputLimit),
      framePng: null,
      webDeviceFrameDiff: null,
    };
    record.repairHint = record.ok ? null : buildRepairHint(record);
    return record;
  }

  async function writeJsonFile(filePath, value) {
    await writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rm(filePath, { force: true });
    await rename(`${filePath}.tmp`, filePath);
  }

  async function writeRecord(record) {
    const dir = recordDir(record.buildId);
    if (!dir) return;

    await mkdir(dir, { recursive: true });
    await writeJsonFile(path.join(dir, "record.json"), record);
    await writeJsonFile(path.join(dir, "summary.json"), summary(record));
    await trim();
  }

  async function persistSyncResult(result, commandResults = {}) {
    const record = buildRecord(result, commandResults);
    if (!result.repairHint) result.repairHint = record.repairHint;
    await writeRecord(record);
    return record;
  }

  async function updateRecord(buildId, updater) {
    const dir = recordDir(buildId);
    if (!dir) return null;

    const recordPath = path.join(dir, "record.json");
    let record;
    try {
      record = JSON.parse(await readFile(recordPath, "utf8"));
    } catch {
      return null;
    }

    const nextRecord = updater(record) || record;
    await writeJsonFile(recordPath, nextRecord);
    await writeJsonFile(path.join(dir, "summary.json"), summary(nextRecord));
    return nextRecord;
  }

  async function readRecord(buildId) {
    const dir = recordDir(buildId);
    if (!dir) return null;

    try {
      return JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
    } catch {
      return null;
    }
  }

  async function readSummary(dirent) {
    const dir = path.join(recordsDir, dirent.name);
    try {
      const recordSummary = JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8"));
      const hasFramePng = await fileExists(path.join(dir, "frame.png"));
      return {
        ...recordSummary,
        hasFramePng,
        frameUrl: hasFramePng ? frameUrl(recordSummary.buildId) : null,
      };
    } catch {
      return null;
    }
  }

  async function listRecords() {
    let entries = [];
    try {
      entries = await readdir(recordsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const summaries = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!safeRecordId(entry.name)) continue;
      const recordSummary = await readSummary(entry);
      if (recordSummary) summaries.push(recordSummary);
    }
    summaries.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    return summaries;
  }

  async function trim() {
    const summaries = await listRecords();
    const stale = summaries.slice(Math.max(recordLimit, 1));
    for (const recordSummary of stale) {
      const dir = recordDir(recordSummary.buildId);
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }

  async function writeFramePng(buildId, parsed) {
    const dir = recordDir(buildId);
    if (!dir) return null;

    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "frame.png"), parsed.bytes);

    const framePng = {
      capturedAt: new Date().toISOString(),
      pngSha256: parsed.capture.pngSha256,
      pngByteLength: parsed.capture.pngByteLength,
      rawSha256: parsed.capture.rawSha256,
      rawByteLength: parsed.capture.rawByteLength,
      width: parsed.capture.width,
      height: parsed.capture.height,
      frameFormat: parsed.capture.frameFormat,
      url: frameUrl(buildId),
    };

    await updateRecord(buildId, (record) => {
      record.framePng = framePng;
      if (record.screenEvidence?.frame && typeof record.screenEvidence.frame === "object") {
        record.screenEvidence.frame.cachedUrl = framePng.url;
      }
      return record;
    });

    return framePng;
  }

  async function readFramePng(buildId) {
    const id = safeRecordId(buildId);
    const dir = recordDir(id);
    if (!id || !dir) return { id, dir: null, bytes: null };

    try {
      return {
        id,
        dir,
        bytes: await readFile(path.join(dir, "frame.png")),
      };
    } catch {
      return { id, dir, bytes: null };
    }
  }

  return {
    safeRecordId,
    recordDir,
    frameUrl,
    summary,
    buildRecord,
    persistSyncResult,
    updateRecord,
    readRecord,
    listRecords,
    writeFramePng,
    readFramePng,
  };
}

function limitedOutput(value, limit) {
  return value.length > limit ? `${value.slice(0, limit)}\n[output truncated]` : value;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
