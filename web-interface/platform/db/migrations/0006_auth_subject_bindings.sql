CREATE TABLE IF NOT EXISTS walnut_orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS walnut_devices (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES walnut_orgs(id) ON DELETE CASCADE,
  label text NOT NULL,
  device_profile text NOT NULL,
  target text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS walnut_devices_org_id_idx
  ON walnut_devices (org_id);

CREATE TABLE IF NOT EXISTS walnut_user_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES walnut_orgs(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES walnut_devices(id) ON DELETE CASCADE,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS walnut_user_bindings_user_device_role_idx
  ON walnut_user_bindings (user_id, device_id, role);

CREATE INDEX IF NOT EXISTS walnut_user_bindings_user_id_idx
  ON walnut_user_bindings (user_id);

CREATE INDEX IF NOT EXISTS walnut_user_bindings_org_id_idx
  ON walnut_user_bindings (org_id);
