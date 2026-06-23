import { readFile } from "node:fs/promises";
import path from "node:path";

type FactPattern = {
  name: string;
  any?: string[];
  all?: string[];
  none?: string[];
};

let cachedFactsPath: string | null = null;
let cachedPatterns: FactPattern[] | null = null;

export async function extractIntentFacts(input: string, { factsPath = path.join(import.meta.dir, "facts.json") }: { factsPath?: string } = {}) {
  const text = String(input || "").trim();
  const patterns = await loadFactPatterns(factsPath);
  const facts: Record<string, any> = { text };
  for (const pattern of patterns) {
    facts[pattern.name] = matchesPattern(text, pattern);
  }
  return facts;
}

async function loadFactPatterns(factsPath: string): Promise<FactPattern[]> {
  if (cachedPatterns && cachedFactsPath === factsPath) return cachedPatterns;
  const parsed = JSON.parse(await readFile(factsPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`intent facts file must be an array: ${factsPath}`);
  for (const pattern of parsed) {
    if (!pattern?.name || typeof pattern.name !== "string") throw new Error("intent fact pattern missing name");
    for (const key of ["any", "all", "none"] as const) {
      if (pattern[key] !== undefined && (!Array.isArray(pattern[key]) || pattern[key].some((item: any) => typeof item !== "string"))) {
        throw new Error(`intent fact ${pattern.name}.${key} must be a string array`);
      }
    }
  }
  cachedFactsPath = factsPath;
  cachedPatterns = parsed;
  return parsed;
}

function matchesPattern(text: string, pattern: FactPattern): boolean {
  const any = pattern.any || [];
  const all = pattern.all || [];
  const none = pattern.none || [];
  if (any.length && !any.some((item) => matchesToken(text, item))) return false;
  if (all.length && !all.every((item) => matchesToken(text, item))) return false;
  if (none.length && none.some((item) => matchesToken(text, item))) return false;
  return any.length > 0 || all.length > 0;
}

function matchesToken(text: string, token: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedToken = token.toLowerCase().trim();
  return normalizedToken ? normalizedText.includes(normalizedToken) : false;
}
