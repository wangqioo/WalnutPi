export function createScreenWorkspaceWorkflows({
  workspaceRoot,
  readSourceAsset,
  wallpaperRenderer,
  appendScreenPlaylistItem,
  writeDefaultScreenPlaylist,
  cleanId,
  cleanSourcePath,
  cleanOutputType,
  cleanPreset,
  cleanAnimation,
  cleanPlaylistMode,
  cleanInteger,
}) {
  if (!wallpaperRenderer || typeof wallpaperRenderer.renderWallpaper !== "function") {
    throw new Error("Screen Workspace workflows require a WallpaperRenderer");
  }

  async function processSourceRequest(body) {
    const sourceAssetRecord = body.sourceAssetId ? await readSourceAsset(body.sourceAssetId) : null;
    const sourcePath = sourceAssetRecord?.originalPath || cleanSourcePath(body.sourcePath || body.path);
    const screenId = cleanId(body.screenId || body.id, "screenId");
    const sourceId = body.sourceId
      ? cleanId(body.sourceId, "sourceId")
      : sourceAssetRecord?.id || `${screenId}-source`;
    const outputType = cleanOutputType(body.outputType || body.type || "static");
    const preset = cleanPreset(body.preset || "fit-cover:480x320");
    const animation = cleanAnimation(body.animation || {});
    const result = await wallpaperRenderer.renderWallpaper({
      workspaceRoot,
      plan: {
        id: body.planId,
        screenId,
        title: body.title,
        description: body.description,
        animation,
      },
      sourceAsset: {
        id: sourceId,
        path: sourcePath,
        selected: true,
        mediaType: body.mediaType || sourceAssetRecord?.mediaType,
        license: body.license || sourceAssetRecord?.license || "unknown-personal-sync",
        origin: body.origin || sourceAssetRecord?.origin || null,
      },
      outputType,
      preset,
    });

    const playlist = body.playlist === false ? null : await writePlaylistForResult(result, body);
    return { result, playlist };
  }

  async function writePlaylistForResult(result, body) {
    const playlistMode = cleanPlaylistMode(body.playlistMode || body.playlistAction || "replace");
    const writePlaylist = playlistMode === "append" ? appendScreenPlaylistItem : writeDefaultScreenPlaylist;
    return await writePlaylist({
      workspaceRoot,
      playlistId: typeof body.playlist === "string" ? body.playlist : "default",
      manifestId: result.screenId,
      durationMs: cleanInteger(body.durationMs || 8000, "durationMs", 1, 86400000),
      repeat: cleanInteger(body.repeat || 1, "repeat", 1, 1000),
      loop: body.loop === undefined ? true : Boolean(body.loop),
    });
  }

  return {
    processSourceRequest,
    writePlaylistForResult,
  };
}
