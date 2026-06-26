import { and, eq } from "drizzle-orm";
import { createWalnutPostgresClient, schema } from "../db/client.ts";

type JsonObject = Record<string, any>;

export type WalnutSubjectBinding = {
  ok: boolean;
  roles: string[];
  orgId: string | null;
  deviceId: string | null;
  deviceProfile: string | null;
  target: string | null;
  source: "postgres";
};

const LOCAL_ORG_ID = "local-control-plane";
const LOCAL_DEVICE_ID = "default-walnutpi";
const OWNER_ROLE = "owner";

export async function resolveWalnutSubjectBinding(
  userId: string,
  environment: JsonObject = {},
): Promise<WalnutSubjectBinding> {
  const client = createWalnutPostgresClient();
  if (!client.ok || !client.db || !client.sql) {
    throw new Error(`auth subject binding database unavailable: ${client.reason || "unknown"}`);
  }
  try {
    await ensureLocalBinding(client.db, userId, environment);
    const rows = await client.db
      .select({
        role: schema.walnutUserBindings.role,
        orgId: schema.walnutUserBindings.orgId,
        deviceId: schema.walnutUserBindings.deviceId,
        deviceProfile: schema.walnutDevices.deviceProfile,
        target: schema.walnutDevices.target,
      })
      .from(schema.walnutUserBindings)
      .innerJoin(schema.walnutDevices, eq(schema.walnutUserBindings.deviceId, schema.walnutDevices.id))
      .where(and(
        eq(schema.walnutUserBindings.userId, userId),
        eq(schema.walnutUserBindings.active, true),
        eq(schema.walnutDevices.active, true),
      ));
    const rawRoles = rows.map((row) => String(row.role || "").trim()).filter((role): role is string => Boolean(role));
    const roles = [...new Set<string>(rawRoles)].sort();
    const first = rows[0];
    return {
      ok: roles.length > 0,
      roles,
      orgId: first?.orgId || null,
      deviceId: first?.deviceId || null,
      deviceProfile: first?.deviceProfile || null,
      target: first?.target || null,
      source: "postgres",
    };
  } finally {
    await client.sql.end({ timeout: 1 });
  }
}

async function ensureLocalBinding(db: JsonObject, userId: string, environment: JsonObject) {
  const target = cleanText(environment.target) || "local-walnutpi-device";
  const deviceProfile = cleanText(environment.deviceProfile) || "device";
  await db
    .insert(schema.walnutOrgs)
    .values({
      id: LOCAL_ORG_ID,
      name: "Local WalnutPi Control Plane",
    })
    .onConflictDoUpdate({
      target: schema.walnutOrgs.id,
      set: {
        name: "Local WalnutPi Control Plane",
        updatedAt: new Date(),
      },
    });
  await db
    .insert(schema.walnutDevices)
    .values({
      id: LOCAL_DEVICE_ID,
      orgId: LOCAL_ORG_ID,
      label: "Default WalnutPi Device",
      deviceProfile,
      target,
      active: true,
    })
    .onConflictDoUpdate({
      target: schema.walnutDevices.id,
      set: {
        orgId: LOCAL_ORG_ID,
        label: "Default WalnutPi Device",
        deviceProfile,
        target,
        active: true,
        updatedAt: new Date(),
      },
    });
  await db
    .insert(schema.walnutUserBindings)
    .values({
      userId,
      orgId: LOCAL_ORG_ID,
      deviceId: LOCAL_DEVICE_ID,
      role: OWNER_ROLE,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.walnutUserBindings.userId,
        schema.walnutUserBindings.deviceId,
        schema.walnutUserBindings.role,
      ],
      set: {
        orgId: LOCAL_ORG_ID,
        active: true,
        updatedAt: new Date(),
      },
    });
}

function cleanText(value: any) {
  return String(value || "").trim();
}
