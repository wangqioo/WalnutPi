import { Buffer } from "node:buffer";

export function createScreenDiagnosticsApi({
  screenEvidenceLedger,
  screenFrameTickets,
  screenFrameTicketTtlMs,
  walnutRemote,
  validSha256,
  sha256,
  json,
}) {
  const safeRecordId = screenEvidenceLedger.safeRecordId;

  function cleanupScreenFrameTickets() {
    const now = Date.now();
    for (const [buildId, ticket] of screenFrameTickets.entries()) {
      if (now - ticket.createdAt > screenFrameTicketTtlMs) {
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

    const captureResult = await walnutRemote.capturePngBase64();
    const parsed = parseCaptureResult(captureResult, { validSha256, sha256 });
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

    let recordWarning = "";
    try {
      await screenEvidenceLedger.writeFramePng(buildId, parsed);
    } catch (error) {
      recordWarning = `screen record frame was not cached: ${error.message}`;
    }

    return new Response(parsed.bytes, {
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-walnut-png-sha256": parsed.capture.pngSha256,
        "x-walnut-raw-sha256": parsed.capture.rawSha256,
        "x-walnut-sync-raw-sha256": ticket.frameSha256 || "",
        "x-walnut-playlist-sha256": ticket.playlistHash || "",
        "x-walnut-manifest-sha256": ticket.manifestHash || "",
        "x-walnut-artifact-sha256": ticket.artifactHash || "",
        "x-walnut-record-warning": recordWarning,
      },
    });
  }

  async function handleScreenRecordFrame(buildId) {
    const { id, bytes } = await screenEvidenceLedger.readFramePng(buildId);
    if (!id) return json({ ok: false, error: "Invalid screen record id" }, 400);
    if (!bytes) return json({ ok: false, error: "screen record frame not found" }, 404);

    if (!validPngBytes(bytes)) {
      return json({ ok: false, error: "screen record frame is not a valid PNG" }, 500);
    }

    const record = await screenEvidenceLedger.readRecord(id);
    return new Response(bytes, {
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-walnut-png-sha256": record?.framePng?.pngSha256 || sha256(bytes),
        "x-walnut-raw-sha256": record?.framePng?.rawSha256 || record?.screenEvidence?.frame?.sha256 || "",
        "x-walnut-playlist-sha256": record?.playlistHash || "",
        "x-walnut-manifest-sha256": record?.manifestHash || "",
        "x-walnut-artifact-sha256": record?.artifactHash || "",
      },
    });
  }

  async function handleScreenRecord(buildId) {
    const id = safeRecordId(buildId);
    if (!id) return json({ ok: false, error: "Invalid screen record id" }, 400);

    const record = await screenEvidenceLedger.readRecord(id);
    if (!record) return json({ ok: false, error: "screen record not found" }, 404);

    return json({
      ok: true,
      record: {
        ...record,
        framePng: record.framePng
          ? {
              ...record.framePng,
              url: screenEvidenceLedger.frameUrl(record.buildId),
            }
          : null,
      },
    });
  }

  async function handleScreenRecordList() {
    return json({
      ok: true,
      records: await screenEvidenceLedger.listRecords(),
    });
  }

  async function handleScreenPixelDiff(req, readJsonRequest) {
    let body;
    try {
      body = await readJsonRequest(req);
    } catch (error) {
      return json({ ok: false, error: error.message }, 400);
    }

    const buildId = String(body.buildId || "").trim();
    const safeBuildId = safeRecordId(buildId);
    if (!safeBuildId) {
      return json({ ok: false, error: "invalid buildId", summary: "缺少有效的同步记录。" }, 400);
    }

    let webDevicePixelDiff;
    try {
      webDevicePixelDiff = normalizeWebDevicePixelDiff(body.webDevicePixelDiff, validSha256);
    } catch (error) {
      return json({ ok: false, error: error.message, summary: "Web/device pixel diff 格式无效。" }, 400);
    }

    const existingRecord = await screenEvidenceLedger.readRecord(safeBuildId);
    if (!existingRecord) {
      return json({ ok: false, error: "screen record not found", summary: "找不到这次同步记录。" }, 404);
    }
    if (
      webDevicePixelDiff.manifestHash
      && existingRecord.manifestHash
      && webDevicePixelDiff.manifestHash !== existingRecord.manifestHash
    ) {
      return json({
        ok: false,
        error: "stale pixel diff manifestHash",
        summary: "Web/device pixel diff 对应的 manifest 和同步记录不一致，请重新打开设备截图。",
        manifestHash: existingRecord.manifestHash,
      }, 409);
    }

    const record = await screenEvidenceLedger.updateRecord(safeBuildId, (nextRecord) => {
      nextRecord.webDevicePixelDiff = webDevicePixelDiff;
      return nextRecord;
    });

    return json({
      ok: true,
      buildId: safeBuildId,
      webDevicePixelDiff: record.webDevicePixelDiff,
    });
  }

  return {
    rememberScreenFrameTicket,
    handleScreenFrame,
    handleScreenRecordFrame,
    handleScreenRecord,
    handleScreenRecordList,
    handleScreenPixelDiff,
  };
}

function parseCaptureResult(result, { validSha256, sha256 }) {
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

function validPngBytes(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return bytes.length > signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function normalizeWebDevicePixelDiff(value, validSha256) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("webDevicePixelDiff must be an object");
  }
  const schema = String(value.schema || "").trim();
  if (!["walnutpi.webDevicePixelDiff.v1", "walnutpi.webDevicePixelDiff.v2"].includes(schema)) {
    throw new Error("webDevicePixelDiff schema must be walnutpi.webDevicePixelDiff.v1 or walnutpi.webDevicePixelDiff.v2");
  }
  const status = String(value.status || "").trim();
  if (!["matched", "different", "unavailable"].includes(status)) {
    throw new Error("webDevicePixelDiff status is invalid");
  }
  const limitations = Array.isArray(value.limitations)
    ? value.limitations.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4)
    : [];
  const manifestHash = value.manifestHash ? String(value.manifestHash).trim() : null;
  if (manifestHash && !validSha256(manifestHash)) {
    throw new Error("manifestHash must be SHA-256 hex");
  }
  const width = cleanPixelDiffInteger(value.width, "width", 1, 4096);
  const height = cleanPixelDiffInteger(value.height, "height", 1, 4096);
  const comparedPixels = schema === "walnutpi.webDevicePixelDiff.v2"
    ? cleanPixelDiffInteger(value.comparedPixels, "comparedPixels", 1, 4096 * 4096)
    : width * height;
  const differentPixels = cleanPixelDiffInteger(value.differentPixels, "differentPixels", 0, 4096 * 4096);
  if (differentPixels > comparedPixels) {
    throw new Error("differentPixels must not exceed comparedPixels");
  }
  return {
    schema,
    status,
    claim: String(value.claim || "web-lvgl-preview-compared-to-device-png").slice(0, 120),
    source: String(value.source || (schema.endsWith(".v2") ? "actual-lvgl-offscreen-bmp" : "semantic-canvas-preview"))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
    manifestHash,
    frameUrl: value.frameUrl ? String(value.frameUrl).slice(0, 240) : null,
    previewHash: cleanPixelDiffHash(value.previewHash, "previewHash", validSha256),
    devicePngHash: cleanPixelDiffHash(value.devicePngHash, "devicePngHash", validSha256),
    width,
    height,
    comparedPixels,
    threshold: cleanPixelDiffNumber(value.threshold, "threshold", 0, 1),
    differentPixels,
    diffRatio: cleanPixelDiffNumber(value.diffRatio, "diffRatio", 0, 1),
    averageChannelDelta: cleanPixelDiffNumber(value.averageChannelDelta, "averageChannelDelta", 0, 255, 3),
    limitations,
    capturedAt: new Date().toISOString(),
  };
}

function cleanPixelDiffHash(value, field, validSha256) {
  const text = String(value || "").trim();
  if (!/^[a-f0-9]{8}$/i.test(text) && !validSha256(text)) {
    throw new Error(`${field} must be an 8-char FNV hash or SHA-256 hex`);
  }
  return text.toLowerCase();
}

function cleanPixelDiffNumber(value, field, min, max, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return Number(number.toFixed(digits));
}

function cleanPixelDiffInteger(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}
