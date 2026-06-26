export function compactRetrievalForPrompt(results, { clip }: { clip: (value: any, limit?: number) => string }) {
  if (!Array.isArray(results) || !results.length) return "无相关检索片段。";
  return results.slice(0, 5).map((item) => [
    `### ${item.title || item.source || item.sourceKind || item.path || "retrieval-result"} (score=${item.score})`,
    clip(item.preview, 1200),
  ].join("\n")).join("\n\n");
}
