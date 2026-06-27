import { createWalnutPostgresClient, schema } from "../db/client.ts";
import { ensureLocalBinding, LOCAL_DEVICE_ID, LOCAL_DEVICE_PROFILE, LOCAL_DEVICE_TARGET, LOCAL_ORG_ID, OWNER_ROLE } from "./subject-bindings.ts";

type JsonObject = Record<string, any>;

const ROLE_ALLOWLIST = new Set(["owner", "operator", "viewer"]);
const DEVICE_PROFILE_ALLOWLIST = new Set(["device"]);

export async function readWalnutSubjectManagement(subject: JsonObject) {
  const auth = requireSignedOwner(subject);
  const client = createWalnutPostgresClient();
  if (!client.ok || !client.db || !client.sql) {
    throw new Error(`auth subject management database unavailable: ${client.reason || "unknown"}`);
  }
  try {
    await ensureLocalBinding(client.db, auth.userId);
    const [orgs, devices, bindings] = await Promise.all([
      client.db
        .select({
          id: schema.walnutOrgs.id,
          name: schema.walnutOrgs.name,
          createdAt: schema.walnutOrgs.createdAt,
          updatedAt: schema.walnutOrgs.updatedAt,
        })
        .from(schema.walnutOrgs),
      client.db
        .select({
          id: schema.walnutDevices.id,
          orgId: schema.walnutDevices.orgId,
          label: schema.walnutDevices.label,
          deviceProfile: schema.walnutDevices.deviceProfile,
          target: schema.walnutDevices.target,
          active: schema.walnutDevices.active,
          createdAt: schema.walnutDevices.createdAt,
          updatedAt: schema.walnutDevices.updatedAt,
        })
        .from(schema.walnutDevices),
      client.db
        .select({
          id: schema.walnutUserBindings.id,
          userId: schema.walnutUserBindings.userId,
          orgId: schema.walnutUserBindings.orgId,
          deviceId: schema.walnutUserBindings.deviceId,
          role: schema.walnutUserBindings.role,
          active: schema.walnutUserBindings.active,
          createdAt: schema.walnutUserBindings.createdAt,
          updatedAt: schema.walnutUserBindings.updatedAt,
        })
        .from(schema.walnutUserBindings),
    ]);
    return {
      ok: true,
      schema: "walnutpi.authSubjectManagement.v1",
      subject: publicManagerSubject(subject),
      orgs,
      devices: devices.map(publicDevice),
      bindings: bindings.map(publicBinding),
      policy: {
        writableBy: "signed better-auth owner only",
        roleAllowlist: [...ROLE_ALLOWLIST],
        deviceProfileAllowlist: [...DEVICE_PROFILE_ALLOWLIST],
        serverOwnedBinding: true,
      },
    };
  } finally {
    await client.sql.end({ timeout: 1 });
  }
}

export async function upsertWalnutSubjectManagement(subject: JsonObject, body: JsonObject) {
  const auth = requireSignedOwner(subject);
  const client = createWalnutPostgresClient();
  if (!client.ok || !client.db || !client.sql) {
    throw new Error(`auth subject management database unavailable: ${client.reason || "unknown"}`);
  }
  try {
    await ensureLocalBinding(client.db, auth.userId);
    const org = cleanOrg(body.org || {});
    const device = cleanDevice(body.device || {}, org.id);
    const binding = cleanBinding(body.binding || {}, {
      userId: auth.userId,
      orgId: org.id,
      deviceId: device.id,
    });
    await client.db.transaction(async (tx: JsonObject) => {
      await tx
        .insert(schema.walnutOrgs)
        .values(org)
        .onConflictDoUpdate({
          target: schema.walnutOrgs.id,
          set: { name: org.name, updatedAt: new Date() },
        });
      await tx
        .insert(schema.walnutDevices)
        .values(device)
        .onConflictDoUpdate({
          target: schema.walnutDevices.id,
          set: {
            orgId: device.orgId,
            label: device.label,
            deviceProfile: device.deviceProfile,
            target: device.target,
            active: device.active,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(schema.walnutUserBindings)
        .values(binding)
        .onConflictDoUpdate({
          target: [
            schema.walnutUserBindings.userId,
            schema.walnutUserBindings.deviceId,
            schema.walnutUserBindings.role,
          ],
          set: {
            orgId: binding.orgId,
            active: binding.active,
            updatedAt: new Date(),
          },
        });
    });
    return {
      ok: true,
      schema: "walnutpi.authSubjectManagement.upsert.v1",
      subject: publicManagerSubject(subject),
      org,
      device: publicDevice(device),
      binding: publicBinding(binding),
      serverOwnedBinding: true,
    };
  } finally {
    await client.sql.end({ timeout: 1 });
  }
}

function requireSignedOwner(subject: JsonObject) {
  if (subject.kind !== "better-auth-user" || subject.authenticated !== true || !subject.userId) {
    throw Object.assign(new Error("signed better-auth owner session required"), { status: 401 });
  }
  const roles = Array.isArray(subject.roles) ? subject.roles.map(String) : [];
  if (!roles.includes(OWNER_ROLE)) {
    throw Object.assign(new Error("owner role required for subject management"), { status: 403 });
  }
  return { userId: String(subject.userId) };
}

function cleanOrg(value: JsonObject) {
  return {
    id: cleanId(value.id || LOCAL_ORG_ID, "org.id"),
    name: cleanText(value.name || "Local WalnutPi Control Plane", "org.name", 120),
  };
}

function cleanDevice(value: JsonObject, orgId: string) {
  const deviceProfile = cleanText(value.deviceProfile || LOCAL_DEVICE_PROFILE, "device.deviceProfile", 40);
  if (!DEVICE_PROFILE_ALLOWLIST.has(deviceProfile)) {
    throw Object.assign(new Error("unsupported device profile"), { status: 400 });
  }
  return {
    id: cleanId(value.id || LOCAL_DEVICE_ID, "device.id"),
    orgId,
    label: cleanText(value.label || "Default WalnutPi Device", "device.label", 120),
    deviceProfile,
    target: cleanTarget(value.target || LOCAL_DEVICE_TARGET),
    active: value.active === false ? false : true,
  };
}

function cleanBinding(value: JsonObject, defaults: JsonObject) {
  const role = cleanText(value.role || OWNER_ROLE, "binding.role", 40);
  if (!ROLE_ALLOWLIST.has(role)) {
    throw Object.assign(new Error("unsupported role"), { status: 400 });
  }
  return {
    userId: cleanText(value.userId || defaults.userId, "binding.userId", 160),
    orgId: cleanId(value.orgId || defaults.orgId, "binding.orgId"),
    deviceId: cleanId(value.deviceId || defaults.deviceId, "binding.deviceId"),
    role,
    active: value.active === false ? false : true,
  };
}

function cleanId(value: any, field: string) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}$/.test(text)) {
    throw Object.assign(new Error(`${field} is invalid`), { status: 400 });
  }
  return text;
}

function cleanTarget(value: any) {
  const text = cleanText(value, "device.target", 160);
  if (/[;&|`$<>]/.test(text) || /\s/.test(text)) {
    throw Object.assign(new Error("device.target must be a single SSH target token"), { status: 400 });
  }
  return text;
}

function cleanText(value: any, field: string, max: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) {
    throw Object.assign(new Error(`${field} is required`), { status: 400 });
  }
  return text;
}

function publicManagerSubject(subject: JsonObject) {
  return {
    kind: subject.kind || null,
    userId: subject.userId || null,
    orgId: subject.orgId || null,
    deviceId: subject.deviceId || null,
    roles: Array.isArray(subject.roles) ? subject.roles.map(String) : [],
  };
}

function publicDevice(device: JsonObject) {
  return {
    id: device.id,
    orgId: device.orgId,
    label: device.label,
    deviceProfile: device.deviceProfile,
    target: device.target,
    active: device.active !== false,
  };
}

function publicBinding(binding: JsonObject) {
  return {
    id: binding.id || null,
    userId: binding.userId,
    orgId: binding.orgId,
    deviceId: binding.deviceId,
    role: binding.role,
    active: binding.active !== false,
  };
}
