import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  screenManifestV2EnvelopeHash,
  screenPlaylistV1Hash,
  validateScreenManifestV2,
  validateScreenPlaylistV1,
} from "../scripts/screen-workspace-vocabulary.ts";

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const ASSET_RE = /^\/api\/screen\/workspace\/assets\/(.+)$/;
type WorkspaceHttpError = Error & { publicMessage: string; status: number };

export function createScreenWorkspaceStore({
  workspaceRoot,
}) {
  const root = path.resolve(workspaceRoot);
  const playlistsDir = path.join(root, "playlists");
  const manifestsDir = path.join(root, "manifests");

  function safeId(value) {
    const text = String(value || "").trim();
    return SAFE_ID_RE.test(text) ? text : null;
  }

  async function readPlaylist(id = "default") {
    const playlistId = safeId(id);
    if (!playlistId) throw httpError(400, "invalid playlist id");
    const playlistPath = path.join(playlistsDir, `${playlistId}.json`);
    const playlist = JSON.parse(await readFile(playlistPath, "utf8"));
    const normalized = await validateScreenPlaylistV1(playlist, {
      playlistPath,
      workspaceRoot: root,
    });
    return {
      playlist: normalized,
      playlistPath,
      playlistHash: screenPlaylistV1Hash(normalized),
    };
  }

  async function readManifest(id) {
    const manifestId = safeId(id);
    if (!manifestId) throw httpError(400, "invalid manifest id");
    const manifestPath = path.join(manifestsDir, `${manifestId}.json`);
    return readManifestByPath(manifestPath);
  }

  async function readManifestByPath(manifestPath) {
    const resolvedManifestPath = path.resolve(manifestPath);
    assertInside(resolvedManifestPath, root, "manifest path");
    const manifest = JSON.parse(await readFile(resolvedManifestPath, "utf8"));
    const normalized = await validateScreenManifestV2(manifest, {
      manifestPath: resolvedManifestPath,
      workspaceRoot: root,
    });
    return {
      manifest: normalized,
      manifestPath: resolvedManifestPath,
      manifestHash: screenManifestV2EnvelopeHash(normalized),
    };
  }

  async function readPlaylistEnvelope(id = "default") {
    const envelope = await readPlaylist(id);
    const items = [];
    for (const [index, item] of envelope.playlist.items.entries()) {
      const manifestPath = resolveWorkspaceReference(item.manifest, path.dirname(envelope.playlistPath), `items[${index}].manifest`);
      const manifestEnvelope = await readManifestByPath(manifestPath);
      items.push({
        ...item,
        manifestId: manifestEnvelope.manifest.id,
        manifestHash: manifestEnvelope.manifestHash,
        hasWidgetApp: Boolean(manifestEnvelope.manifest.provenance?.widgetApp?.catalog),
        hasRuntimeWidgets: Boolean(manifestEnvelope.manifest.provenance?.widgetApp?.catalog)
          || (Array.isArray(manifestEnvelope.manifest.provenance?.runtimeWidgets)
            && manifestEnvelope.manifest.provenance.runtimeWidgets.length > 0),
        output: publicOutput(manifestEnvelope.manifest, manifestEnvelope.manifestPath),
      });
    }
    return {
      schema: "walnutpi.screenWorkspacePlaylistEnvelope.v1",
      ok: true,
      workspaceRoot: root,
      playlist: envelope.playlist,
      playlistHash: envelope.playlistHash,
      items,
    };
  }

  async function assetResponse(urlPathname) {
    const match = urlPathname.match(ASSET_RE);
    if (!match) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(match[1]);
    } catch {
      throw httpError(400, "invalid asset path");
    }
    const filePath = path.resolve(root, decoded);
    assertInside(filePath, root, "asset path");
    const stats = await stat(filePath).catch(() => null);
    if (!stats?.isFile()) throw httpError(404, "asset not found");
    return {
      filePath,
      headers: {
        "content-type": contentType(filePath),
        "cache-control": "no-store",
      },
    };
  }

  function publicAssetUrl(filePath) {
    const resolved = path.resolve(filePath);
    assertInside(resolved, root, "asset path");
    return `/api/screen/workspace/assets/${encodeURIComponent(path.relative(root, resolved).replaceAll("\\", "/"))}`;
  }

  function publicOutput(manifest, manifestPath) {
    const manifestDir = path.dirname(manifestPath);
    if (manifest.output.type === "static") {
      const outputPath = resolveWorkspaceReference(manifest.output.path, manifestDir, "output.path");
      return {
        ...manifest.output,
        url: publicAssetUrl(outputPath),
      };
    }
    return {
      ...manifest.output,
      url: publicAssetUrl(resolveWorkspaceReference(manifest.output.path, manifestDir, "output.path")),
      frames: manifest.output.frames.map((frame) => ({
        ...frame,
        url: publicAssetUrl(resolveWorkspaceReference(frame.path, manifestDir, "frame.path")),
      })),
    };
  }

  function resolveWorkspaceReference(relativePath, baseDir, field) {
    const resolved = path.resolve(baseDir, relativePath);
    assertInside(resolved, root, field);
    return resolved;
  }

  return {
    workspaceRoot: root,
    safeId,
    readPlaylist,
    readManifest,
    readPlaylistEnvelope,
    assetResponse,
  };
}

export function workspaceErrorResponse(error, json) {
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  return json(
    {
      ok: false,
      error: error?.publicMessage || "screen workspace error",
      output: status >= 500 ? error?.message : undefined,
    },
    status,
  );
}

function assertInside(filePath, root, field) {
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw httpError(400, `${field} must stay inside the screen workspace`);
  }
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".json":
      return "application/json; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function httpError(status, publicMessage) {
  const error = new Error(publicMessage) as WorkspaceHttpError;
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}
