import { createLocalOwnerAuthContext } from "../platform/auth/auth.ts";

type JsonObject = Record<string, any>;

export function createMcpAuthContext(req: Request, environment: JsonObject = {}): JsonObject {
  const url = new URL(req.url);
  const subject = createLocalOwnerAuthContext();
  return {
    subject: {
      ...subject,
      approvalToken: req.headers.get("x-walnut-approval-token") || subject.approvalToken || null,
    },
    environment: {
      ...environment,
      previewOnly: url.searchParams.get("previewOnly") === "1" || url.searchParams.get("preview") === "1",
      deviceProfile: environment.deviceProfile || "device",
      target: environment.target || null,
    },
  };
}

export function mergeToolAuthContext(base: JsonObject = {}, params: JsonObject = {}): JsonObject {
  const subject = objectOrEmpty(base.subject);
  const environment = objectOrEmpty(base.environment);
  return {
    subject: {
      ...subject,
      approvalToken: params.approvalToken || subject.approvalToken || null,
    },
    environment: {
      ...environment,
      previewOnly: params.previewOnly === true || params.mode === "preview" || environment.previewOnly === true,
      deviceProfile: environment.deviceProfile || "device",
      target: environment.target || null,
    },
  };
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
