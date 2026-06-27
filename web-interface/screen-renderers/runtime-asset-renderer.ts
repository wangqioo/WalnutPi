import path from "node:path";
import {
  buildRuntimeScreenAssets,
  writeRuntimeScreenAssets,
} from "../../scripts/runtime-screen-assets.ts";

export type RuntimeAssetRendererOptions = {
  workspaceRoot: string;
  playlistId: string;
  outputDir?: string;
};

export type RuntimeAssetRendererResult = {
  runtimeDir: string;
  indexPath: string;
  frames: string[];
  playlistHash: string;
};

export type RuntimeAssetRenderer = {
  renderRuntimeAssets(options: RuntimeAssetRendererOptions): Promise<RuntimeAssetRendererResult>;
};

export function createRuntimeAssetRenderer(): RuntimeAssetRenderer {
  return {
    async renderRuntimeAssets({
      workspaceRoot,
      playlistId,
      outputDir,
    }: RuntimeAssetRendererOptions): Promise<RuntimeAssetRendererResult> {
      const workspace = path.resolve(workspaceRoot);
      const runtimeDir = path.resolve(outputDir || path.join(workspace, "runtime"));
      const config = await buildRuntimeScreenAssets({ workspace, playlistId });
      const written = await writeRuntimeScreenAssets(config, { runtimeDir });
      return {
        runtimeDir,
        indexPath: written.indexPath,
        frames: written.framePaths,
        playlistHash: config.playlistHash,
      };
    },
  };
}
