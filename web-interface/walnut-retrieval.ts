import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type RetrievalOptions = {
  corpusDir: string;
  fileLimit: number;
  primarySkill: string;
  projectRoot: string;
  resultLimit: number;
  skillsDir: string;
};

const RETRIEVAL_TEXT_EXTENSIONS = new Set([".md", ".json", ".txt", ".py", ".c", ".h"]);
const RETRIEVAL_SYNONYMS: Array<[string, string[]]> = [
  ["屏幕", ["screen", "lvgl", "fb0", "framebuffer"]],
  ["小屏", ["screen", "lvgl", "fb0", "framebuffer"]],
  ["同步", ["sync", "manifest", "delivery"]],
  ["记忆", ["memory", "retrieval"]],
  ["检索", ["retrieval", "skills", "corpus"]],
  ["成功代码", ["corpus", "recipe", "example"]],
  ["gpio", ["引脚", "排针"]],
  ["i2c", ["传感器", "sensor"]],
];
const RETRIEVAL_BASE_FILES = new Set(["walnutpi-core.md", "walnutpi-screen.md"]);
const RETRIEVAL_PATH_SCORE_RULES = [
  { suffix: "walnutpi-core.md", score: 1 },
  { suffix: "walnutpi-screen.md", score: 4, terms: ["screen", "lvgl", "fb0", "framebuffer"] },
  { suffix: "screen-sync-successes.md", score: 4, terms: ["sync", "manifest", "delivery", "成功代码"] },
];

export async function retrieveWalnutContext(query: string, options: RetrievalOptions) {
  const terms = tokenizeQuery(query);
  const files = await listRetrievalFiles(options);
  const results = [];
  for (const filePath of files) {
    const content = await readTextFileLimited(filePath, options.fileLimit);
    if (!content) continue;
    const score = scoreRetrievalFile(filePath, content, terms);
    if (score <= 0 && !isRetrievalBaseFile(filePath)) continue;
    results.push({
      path: path.relative(options.projectRoot, filePath).replace(/\\/g, "/"),
      score,
      preview: content,
    });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return results.slice(0, options.resultLimit);
}

export function compactRetrievalForPrompt(results, { clip }: { clip: (value: any, limit?: number) => string }) {
  if (!Array.isArray(results) || !results.length) return "无相关检索片段。";
  return results.slice(0, 5).map((item) => [
    `### ${item.path} (score=${item.score})`,
    clip(item.preview, 1200),
  ].join("\n")).join("\n\n");
}

function tokenizeQuery(value) {
  const text = String(value || "").toLowerCase();
  const terms = new Set(text.match(/[a-z0-9_./:-]+|[\u4e00-\u9fff]{2,}/g) || []);
  for (const [key, values] of RETRIEVAL_SYNONYMS) {
    if (text.includes(key) || terms.has(key)) values.forEach((term) => terms.add(term));
  }
  return terms;
}

async function readTextFileLimited(filePath, limit) {
  const extension = path.extname(filePath).toLowerCase();
  if (!RETRIEVAL_TEXT_EXTENSIONS.has(extension)) return "";
  try {
    return (await readFile(filePath, "utf8")).trim().slice(0, limit);
  } catch {
    return "";
  }
}

async function listRetrievalFiles(options: RetrievalOptions) {
  const files = [
    path.join(options.skillsDir, "walnutpi-core.md"),
    path.join(options.skillsDir, "walnutpi-screen.md"),
    path.join(options.skillsDir, options.primarySkill, "SKILL.md"),
    path.join(options.corpusDir, "successful-code.md"),
  ];
  async function addDirectoryMarkdown(root, depth = 1) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
      if (entry.isDirectory() && depth > 0) files.push(path.join(entryPath, "SKILL.md"));
    }
  }
  await addDirectoryMarkdown(options.skillsDir, 1);
  await addDirectoryMarkdown(path.join(options.skillsDir, options.primarySkill), 0);
  await addDirectoryMarkdown(options.corpusDir, 0);
  return [...new Set(files.map((file) => path.resolve(file)))];
}

function scoreRetrievalFile(filePath, data, terms) {
  const lowerPath = filePath.toLowerCase();
  const haystack = `${lowerPath}\n${data.slice(0, 2000).toLowerCase()}`;
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (lowerPath.includes(term)) score += 3;
    else if (haystack.includes(term)) score += 1;
  }
  for (const rule of RETRIEVAL_PATH_SCORE_RULES) {
    if (filePath.endsWith(rule.suffix) && (!rule.terms || rule.terms.some((term) => terms.has(term)))) score += rule.score;
  }
  return score;
}

function isRetrievalBaseFile(filePath) {
  return [...RETRIEVAL_BASE_FILES].some((suffix) => filePath.endsWith(suffix));
}
