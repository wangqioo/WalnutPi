import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const manifestPath = path.join(root, "lvgl_app", "screen-manifest.json");
const backupPath = path.join(import.meta.dirname, "screen-manifest.before-temp-pixel-loop.json");

const width = 30;
const height = 20;
const palette = {
  B: "0x05070a",
  D: "0x10181f",
  C: "0x27e0ff",
  A: "0xffd166",
  P: "0xff5fb7",
  G: "0x39ff88",
  R: "0xff3b3b",
  W: "0xf7f1d0",
  S: "0x66717a",
  O: "0xff8c42",
  M: "0x8b5cf6",
  T: "0x5eead4",
};

function blank(ch = "B") {
  return Array.from({ length: height }, () => Array(width).fill(ch));
}

function rect(g, x, y, w, h, ch) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      if (yy >= 0 && yy < height && xx >= 0 && xx < width) g[yy][xx] = ch;
    }
  }
}

function drawRain(g, phase) {
  for (let y = 1; y < 19; y += 2) {
    for (let x = (phase + y * 2) % 6; x < 30; x += 7) {
      if (g[y][x] === "B") g[y][x] = phase % 2 ? "T" : "S";
      if (y + 1 < 19 && g[y + 1][x] === "B") g[y + 1][x] = "D";
    }
  }
}

function drawSign(g, phase) {
  const sign = phase % 2 ? "A" : "C";
  const text = phase % 2 ? "G" : "W";
  rect(g, 2, 2, 26, 6, sign);
  rect(g, 3, 3, 24, 4, "B");
  const marquee = [
    "WWBWWBWWWWBWWBWWB",
    "GGGBGBGGGBBGBGGGB",
    "WBBWWBWWBWWWWBWWB",
    "GBGGGBBGBGGGBGBGG",
    "WWWWBWWBWWBWWWWBW",
    "GGGBGBGGGBGBGGGBB",
    "WBBWWWWBWWBWWBWWB",
    "GBGGGBGBGGGBBGBGG",
  ][phase];
  for (let i = 0; i < 18; i += 1) {
    const x = 5 + i;
    const ch = marquee[i] === "B" ? "B" : text;
    g[4][x] = ch;
    if ((i + phase) % 3 !== 0) g[5][x] = ch;
  }
  for (let x = phase % 3; x < 30; x += 5) rect(g, x, 8, 2, 1, phase % 2 ? "P" : "G");
}

function drawTrain(g, phase) {
  rect(g, 2, 13, 17, 3, "D");
  rect(g, 4, 12, 11, 2, "D");
  rect(g, 5, 12, 3, 1, phase % 2 ? "T" : "C");
  rect(g, 10, 12, 3, 1, phase % 2 ? "C" : "T");
  rect(g, 16, 12, 2, 1, phase % 2 ? "A" : "O");
  rect(g, 5 + (phase % 2), 16, 2, 1, "A");
  rect(g, 14 - (phase % 2), 16, 2, 1, "A");
  for (let i = 0; i < 5; i += 1) rect(g, 3 + i * 3, 17, 1, 1, i % 2 ? "S" : "D");
}

function drawCat(g, phase) {
  const eyeLeft = phase === 2 || phase === 6 ? "B" : phase % 2 ? "W" : "C";
  const eyeRight = phase === 2 || phase === 6 ? "B" : phase % 2 ? "C" : "W";
  const mouth = phase % 4 < 2 ? "R" : "O";
  rect(g, 21, 12, 6, 5, "P");
  rect(g, 22, 10, 4, 2, "P");
  rect(g, 22, 9, 1, 1, "P");
  rect(g, 26, 9, 1, 1, "P");
  rect(g, 23, 11, 1, 1, eyeLeft);
  rect(g, 25, 11, 1, 1, eyeRight);
  rect(g, 24, 13, 1, 1, mouth);
  rect(g, 20 - (phase % 2), 15, 1, 1, "P");
  rect(g, 27, 13 + (phase % 3), 1, 2, "P");
  rect(g, 23, 17, 1, 1, "W");
  rect(g, 26, 17, 1, 1, "W");
}

function drawAudio(g, phase) {
  const heights = [1, 2, 3, 2, 4, 2, 3, 1];
  for (let i = 0; i < heights.length; i += 1) {
    const h = 1 + ((heights[(i + phase) % heights.length] + phase + i) % 4);
    rect(g, 2 + i * 2, 18 - h, 1, h, i % 2 ? "M" : "G");
  }
}

function frame(phase) {
  const g = blank();
  rect(g, 0, 0, 30, 1, "D");
  rect(g, 0, 19, 30, 1, "D");
  rect(g, 0, 0, 1, 20, "D");
  rect(g, 29, 0, 1, 20, "D");
  drawRain(g, phase);
  drawSign(g, phase);
  rect(g, 2, 10, 26, 1, "S");
  drawTrain(g, phase);
  drawCat(g, phase);
  drawAudio(g, phase);
  rect(g, (phase * 4) % 30, 1, 1, 18, phase % 2 ? "A" : "C");
  return g.map((row) => row.join(""));
}

const frames = Array.from({ length: 8 }, (_, phase) => ({
  durationMs: phase % 2 ? 150 : 220,
  rows: frame(phase),
}));

for (const [frameIndex, item] of frames.entries()) {
  if (item.rows.length !== height) throw new Error(`frame ${frameIndex} height mismatch`);
  for (const [rowIndex, row] of item.rows.entries()) {
    if (row.length !== width) throw new Error(`frame ${frameIndex} row ${rowIndex} width mismatch`);
    for (const symbol of row) {
      if (symbol !== "." && !Object.hasOwn(palette, symbol)) {
        throw new Error(`frame ${frameIndex} row ${rowIndex} unknown symbol ${symbol}`);
      }
    }
  }
}

await mkdir(import.meta.dirname, { recursive: true });
try {
  await readFile(backupPath, "utf8");
} catch {
  await copyFile(manifestPath, backupPath);
}

const manifest = {
  schema: "walnutpi.screen.v1",
  id: "walnutpi-temp-pixel-party",
  title: "Pixel Party",
  subtitle: "temporary rain cat loop",
  target: {
    runtime: "lvgl-fbdev",
    display: "/dev/fb0",
    width: 480,
    height: 320,
    color: "RGB565",
  },
  source: {
    lvglEntry: "lvgl_app/src/main.c",
    command: "walnut screen start",
  },
  pages: [
    {
      id: "temp-pixel-party",
      tab: "TEMP",
      components: [
        {
          type: "pixelArt",
          background: "0x05070a",
          x: 0,
          y: 0,
          width,
          height,
          pixelSize: 16,
          gap: 0,
          palette,
          frames,
        },
      ],
    },
  ],
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(manifestPath);
