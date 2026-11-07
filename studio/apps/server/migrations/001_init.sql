-- Sound Ninja Design Studio — initial schema.
-- Conventions: uuid PKs, timestamptz, explicit units in column names (_mm, _kg, _w),
-- append-only history tables (superseded_at) for anything a user attests to.
-- tenant_id is present on top-level entities for future multi-tenant SaaS; a single
-- default tenant is used for private Sound Ninja deployment.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','inventory_manager','designer','technical_reviewer','viewer')),
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_session (
  token_hash text PRIMARY KEY,           -- sha256 of the random session token; token itself never stored
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON user_session(user_id);

CREATE TABLE audit_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenant(id),
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES app_user(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON audit_event(entity_type, entity_id);
CREATE INDEX ON audit_event(at DESC);

-- Protected object storage metadata (content-addressed; bytes live in the object store).
CREATE TABLE stored_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  sha256 text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  uploaded_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------
-- Equipment knowledge base (independent of inventory snapshots)
-- ---------------------------------------------------------------------------------------
CREATE TABLE product_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  manufacturer text,                     -- null until identified
  model text NOT NULL,                   -- precise model string; never generalised across variants
  variant text NOT NULL DEFAULT '',
  category text NOT NULL,                -- engineering taxonomy (core/inventory/taxonomy.ts)
  category_status text NOT NULL DEFAULT 'ESTIMATED',
  identity_status text NOT NULL DEFAULT 'PROVISIONAL',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, manufacturer, model, variant)
);

CREATE TABLE spec_value (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_model_id uuid NOT NULL REFERENCES product_model(id),
  key text NOT NULL,
  value_num double precision,
  value_text text,
  unit text NOT NULL,
  status text NOT NULL CHECK (status IN ('VERIFIED','PROVISIONAL','ESTIMATED','UNKNOWN')),
  source jsonb NOT NULL,                 -- {kind, ref, url, documentDate, licence, note}
  entered_by uuid REFERENCES app_user(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE INDEX ON spec_value(product_model_id, key) WHERE superseded_at IS NULL;

CREATE TABLE equipment_relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  type text NOT NULL CHECK (type IN ('REQUIRES','REQUIRES_ONE_OF','COMPATIBLE_WITH','INCOMPATIBLE_WITH','CONNECTS_TO','MOUNTS_TO','POWERED_BY','CONTROLLED_BY','COMPONENT_OF','OPTIONAL_ACCESSORY','ALTERNATIVE_TO')),
  from_model_id uuid NOT NULL REFERENCES product_model(id),
  to_model_id uuid REFERENCES product_model(id),
  to_category text,
  to_one_of uuid[],
  quantity_rule jsonb NOT NULL DEFAULT '{"kind":"none"}',
  constraints jsonb NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('VERIFIED','PROVISIONAL','ESTIMATED','UNKNOWN')),
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CHECK (to_model_id IS NOT NULL OR to_category IS NOT NULL OR to_one_of IS NOT NULL)
);

-- Physical / 3D assets per model (geometry separate from display appearance).
CREATE TABLE asset_3d (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_model_id uuid NOT NULL REFERENCES product_model(id),
  kind text NOT NULL CHECK (kind IN ('parametric','gltf')),
  file_id uuid REFERENCES stored_file(id),
  bbox_mm jsonb,                         -- {x,y,z} physical extents
  geometry_status text NOT NULL DEFAULT 'UNKNOWN',
  appearance jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------
-- Inventory: stable items + immutable snapshots + attested quantities
-- ---------------------------------------------------------------------------------------
CREATE TABLE inventory_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  rms_id text,                           -- stable source identity where available
  product_model_id uuid REFERENCES product_model(id),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_item_rms ON inventory_item(tenant_id, rms_id) WHERE rms_id IS NOT NULL;

CREATE TABLE inventory_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  file_id uuid NOT NULL REFERENCES stored_file(id),
  sheet_name text,
  status text NOT NULL CHECK (status IN ('staged','applied','discarded','failed')),
  parse_result jsonb,                    -- mapping, records, issues (verbatim)
  diff jsonb,
  base_snapshot_id uuid,
  error text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_snapshot_id uuid
);

CREATE TABLE inventory_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  version integer NOT NULL,
  import_id uuid REFERENCES inventory_import(id),
  parent_snapshot_id uuid REFERENCES inventory_snapshot(id),
  kind text NOT NULL CHECK (kind IN ('import','rollback')),
  note text,
  is_current boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);
CREATE UNIQUE INDEX inventory_snapshot_current ON inventory_snapshot(tenant_id) WHERE is_current;

CREATE TABLE inventory_snapshot_item (
  snapshot_id uuid NOT NULL REFERENCES inventory_snapshot(id),
  item_id uuid NOT NULL REFERENCES inventory_item(id),
  source_row integer,                    -- null when carried forward (kept despite missing from file)
  rms_id text,
  product text NOT NULL,
  product_group text,                    -- original group, preserved verbatim
  qty_shown numeric,                     -- PROVISIONAL: source "available to rent", never allocated directly
  qty_shown_raw text,
  rental_rate numeric,
  rental_rate_raw text,
  currency text,
  charge_period text,
  data_flag text,
  raw jsonb NOT NULL DEFAULT '{}',
  issues text[] NOT NULL DEFAULT '{}',
  in_source_file boolean NOT NULL DEFAULT true,
  PRIMARY KEY (snapshot_id, item_id)
);

CREATE TABLE quantity_confirmation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_item(id),
  qty_owned integer NOT NULL CHECK (qty_owned >= 0),
  basis text NOT NULL,                   -- e.g. "physical count", "accepted file quantity"
  snapshot_id uuid REFERENCES inventory_snapshot(id),
  confirmed_by uuid NOT NULL REFERENCES app_user(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX quantity_confirmation_current ON quantity_confirmation(item_id) WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------------------
CREATE TABLE venue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  address text,
  notes text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venue_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue(id),
  kind text NOT NULL CHECK (kind IN ('upload','official_url','other_url')),
  title text NOT NULL,
  url text,
  file_id uuid REFERENCES stored_file(id),
  document_date date,
  licence text,
  status text NOT NULL DEFAULT 'PROVISIONAL',
  notes text,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_user(id)
);

CREATE TABLE venue_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue(id),
  source_id uuid NOT NULL REFERENCES venue_source(id),
  page_number integer NOT NULL DEFAULT 1,
  page_width_pt double precision,
  page_height_pt double precision,
  calibration jsonb,                     -- CalibrationInput + CalibrationResult
  calibration_status text NOT NULL DEFAULT 'UNKNOWN',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venue_geometry_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venue(id),
  plan_id uuid REFERENCES venue_plan(id),
  version integer NOT NULL,
  geometry jsonb NOT NULL,               -- room polygon (mm), obstacles, ceiling height (Sourced), page polygon (pt)
  status text NOT NULL,
  note text,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, version)
);

-- ---------------------------------------------------------------------------------------
-- Projects and immutable design revisions
-- ---------------------------------------------------------------------------------------
CREATE TABLE project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  name text NOT NULL,
  client text,
  brief text NOT NULL DEFAULT '',
  venue_id uuid REFERENCES venue(id),
  mode text NOT NULL DEFAULT 'concept' CHECK (mode IN ('concept','technical')),
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE design_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  number integer NOT NULL,
  parent_id uuid REFERENCES design_revision(id),
  params jsonb NOT NULL,                 -- DesignParams (intent + provenance)
  stage_wall_index integer NOT NULL DEFAULT 0,
  inventory_snapshot_id uuid REFERENCES inventory_snapshot(id),
  venue_geometry_id uuid REFERENCES venue_geometry_version(id),
  inputs jsonb NOT NULL,                 -- frozen DesignContext (stock, specs, relationships, venue) for reproducibility
  input_hash text NOT NULL,
  result jsonb NOT NULL,                 -- DesignResult: scene, bom, validation, assumptions
  overall_status text NOT NULL,
  change_summary text NOT NULL,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE project_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id),
  role text NOT NULL CHECK (role IN ('user','assistant')),
  text text NOT NULL,
  revision_id uuid REFERENCES design_revision(id),
  user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE render_output (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES design_revision(id),
  file_id uuid NOT NULL REFERENCES stored_file(id),
  kind text NOT NULL CHECK (kind IN ('native_realtime','pathtraced','generative_enhanced')),
  viewpoint text,
  camera jsonb,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES design_revision(id),
  discipline text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','comment')),
  comment text,
  user_id uuid NOT NULL REFERENCES app_user(id),
  at timestamptz NOT NULL DEFAULT now()
);
