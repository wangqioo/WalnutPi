import { resolveWalnutSubjectFromRequest } from "../platform/auth/auth.ts";

type JsonObject = Record<string, any>;

export async function createMcpAuthContext(req: Request, environment: JsonObject = {}): Promise<JsonObject> {
  const url = new URL(req.url);
  const subject = await resolveWalnutSubjectFromRequest(req, environment);
  return {
    subject: {
      ...subject,
      approvalToken: req.headers.get("x-walnut-approval-token") || subject.approvalToken || null,
    },
    environment: {
      ...environment,
      previewOnly: url.searchParams.get("previewOnly") === "1" || url.searchParams.get("preview") === "1",
      deviceProfile: subject.deviceProfile || environment.deviceProfile || "device",
      target: subject.target || environment.target || null,
      orgId: subject.orgId || environment.orgId || null,
      deviceId: subject.deviceId || environment.deviceId || null,
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
      orgId: environment.orgId || null,
      deviceId: environment.deviceId || null,
    },
  };
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
