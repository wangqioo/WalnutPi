import { betterAuth } from "better-auth";
import { getAuthConfig } from "../config/platform-config.ts";

type JsonObject = Record<string, any>;

export function createWalnutAuth() {
  const config = getAuthConfig();
  return betterAuth({
    appName: "WalnutPi",
    secret: config.secret,
    baseURL: config.baseUrl,
    emailAndPassword: {
      enabled: false,
    },
  });
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
