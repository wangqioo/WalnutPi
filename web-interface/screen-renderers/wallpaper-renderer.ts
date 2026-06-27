import {
  processSourceAssetToScreenOutput,
  type ProcessSourceOptions,
  type ProcessSourceResult,
} from "../../scripts/screen-workspace-pipeline.ts";

export type WallpaperRenderer = {
  renderWallpaper(options: ProcessSourceOptions): Promise<ProcessSourceResult>;
};

export function createWallpaperRenderer(): WallpaperRenderer {
  return {
    renderWallpaper(options) {
      return processSourceAssetToScreenOutput(options);
    },
  };
}
