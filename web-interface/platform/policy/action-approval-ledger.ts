import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, any>;

export type ActionApprovalRecord = JsonObject & {
  actionId: string;
  approvalTokenHash: string;
  commandBindingId: string;
  decisionId: string;
  expiresAt: string;
  paramsHash: string;
  status: "prepared" | "committed" | "expired" | "refused";
  subjectHash: string;
};

export function createActionApprovalLedger({
  filePath = path.join(process.cwd(), "web-interface", "data", "action-approvals.json"),
}: {
  filePath?: string;
} = {}) {
  let cache: ActionApprovalRecord[] | null = null;

  async function readAll(): Promise<ActionApprovalRecord[]> {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      cache = Array.isArray(parsed?.records) ? parsed.records : [];
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      cache = [];
    }
    return cache;
  }

  async function append(record: ActionApprovalRecord) {
    const records = await readAll();
    const next = [...records, record];
    cache = next;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ schema: "walnutpi.action-approval-ledger.v1", records: next }, null, 2)}\n`, "utf8");
    return record;
  }

  async function latestByDecisionId(decisionId: string) {
    const records = await readAll();
    return [...records].reverse().find((record) => record.decisionId === decisionId) || null;
  }

  return {
    append,
    latestByDecisionId,
    readAll,
  };
}
