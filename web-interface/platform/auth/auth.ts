import { betterAuth } from "better-auth";
import { getAuthConfig } from "../config/platform-config.ts";

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
    approvalToken: null,
  };
}
