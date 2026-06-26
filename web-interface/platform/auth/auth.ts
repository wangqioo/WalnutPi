import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createWalnutPostgresClient, schema } from "../db/client.ts";
import { getAuthConfig } from "../config/platform-config.ts";

type JsonObject = Record<string, any>;

type WalnutAuth = ReturnType<typeof buildWalnutAuth>;

let cachedAuth: WalnutAuth | null = null;
let cachedAuthSql: { end: (options?: { timeout?: number }) => Promise<void> } | null = null;

export function createWalnutAuth() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = buildWalnutAuth();
  return cachedAuth;
}

function buildWalnutAuth() {
  const config = getAuthConfig();
  const client = createWalnutPostgresClient();
  if (!client.ok || !client.db) {
    throw new Error(`better-auth database unavailable: ${client.reason || "unknown"}`);
  }
  cachedAuthSql = client.sql;
  return betterAuth({
    appName: "WalnutPi",
    secret: config.secret,
    baseURL: config.baseUrl,
    database: drizzleAdapter(client.db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
  });
}

export async function closeWalnutAuthForTests() {
  const sql = cachedAuthSql;
  cachedAuth = null;
  cachedAuthSql = null;
  if (sql) await sql.end({ timeout: 1 });
}

export function createLocalOwnerAuthContext() {
  return {
    kind: "local-user",
    authenticated: true,
    roles: ["owner"],
    userId: "local-owner",
    sessionId: null,
    approvalToken: null,
    approvalTokenProof: null,
  };
}

export async function resolveWalnutSubjectFromRequest(req: Request): Promise<JsonObject> {
  const auth = createWalnutAuth();
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    } as any);
    if (session?.user?.id) {
      return {
        kind: "better-auth-user",
        authenticated: true,
        roles: rolesForSession(session),
        userId: session.user.id,
        sessionId: session.session?.id || null,
        approvalToken: null,
        approvalTokenProof: null,
      };
    }
  } catch {
    // A missing better-auth session is not a client-controlled identity failure.
  }
  return createLocalOwnerAuthContext();
}

function rolesForSession(session: JsonObject) {
  const roles = session?.user?.role || session?.user?.roles;
  if (Array.isArray(roles)) return roles.map(String).filter(Boolean);
  if (typeof roles === "string" && roles.trim()) return [roles.trim()];
  return ["owner"];
}
