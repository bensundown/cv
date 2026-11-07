-- Tenant-level settings (e.g. stock allocation policy). Values are JSON; history is in audit_event.
CREATE TABLE tenant_setting (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
