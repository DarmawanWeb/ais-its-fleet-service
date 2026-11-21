-- 0001_init — initial schema of ais-its-fleet-service (docs/PLATFORM_SPEC.md §6, §13.3).
--
-- Runs inside schema "fleet" (search_path=fleet,public) as the role
-- fleet_svc, in one transaction. The infrastructure creates the extensions
-- (timescaledb, postgis, pgcrypto) in "public"; services never CREATE EXTENSION.
-- Migrations are forward-only: once applied anywhere, never edit this file
-- (its checksum is verified at startup) — add 0002_<change>.sql instead.

COMMENT ON SCHEMA fleet IS 'fleet service — owned by fleet_svc';

-- ---------------------------------------------------------------------------
-- Reference data (global, read: vessel:read, write: reference:write)
-- ---------------------------------------------------------------------------

-- Ship types with their CII reference line CII_ref = a · Capacity^(−c)
-- (MEPC.353(78) G2) and rating vector d1..d4 = exp(d_i) (MEPC.354(78) G4).
CREATE TABLE vessel_types (
  id             uuid PRIMARY KEY,
  code           text NOT NULL CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) <= 64),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  capacity_unit  text NOT NULL CHECK (capacity_unit IN ('DWT', 'GT')),
  a              double precision NOT NULL CHECK (a > 0),
  c              double precision NOT NULL,
  -- Regulation-fixed capacity of a size band (e.g. 279 000 DWT); NULL = the vessel's own capacity.
  capacity_fixed double precision CHECK (capacity_fixed > 0),
  d1             double precision NOT NULL CHECK (d1 > 0),
  d2             double precision NOT NULL,
  d3             double precision NOT NULL,
  d4             double precision NOT NULL,
  -- Legacy web icon code (fe-legacy/public/ships/<icon>.png).
  icon           text CHECK (icon IN ('bulkca', 'combin', 'contai', 'cruise', 'gascar', 'genera',
                                      'lngcar', 'refrig', 'ro-roc', 'ro-rop', 'ro-rov', 'tanker', 'unknown')),
  source         text CHECK (char_length(source) <= 2000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vessel_types_code_key UNIQUE (code),
  CONSTRAINT vessel_types_d_increasing CHECK (d1 < d2 AND d2 < d3 AND d3 < d4)
);

-- Fuels with the CO2 conversion factor Cf (t CO2 / t fuel, MEPC.364(79)) and density (t/m3 = kg/L).
CREATE TABLE fuels (
  id                uuid PRIMARY KEY,
  code              text NOT NULL CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) <= 64),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  carbon_content    double precision NOT NULL CHECK (carbon_content BETWEEN 0 AND 1),
  conversion_factor double precision NOT NULL CHECK (conversion_factor > 0),
  density           double precision NOT NULL CHECK (density > 0),
  source            text CHECK (char_length(source) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fuels_code_key UNIQUE (code)
);

-- Engine catalogue (legacy MainEngine / AuxiliaryEngine collections).
CREATE TABLE engines (
  id         uuid PRIMARY KEY,
  -- Stable seed / import key (optional for engines created through the API).
  code       text CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) <= 64),
  kind       text NOT NULL CHECK (kind IN ('main', 'auxiliary')),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  rpm        double precision NOT NULL CHECK (rpm >= 0),
  power_kw   double precision NOT NULL CHECK (power_kw >= 0),
  -- Specific fuel oil consumption, g/kWh.
  sfoc       double precision NOT NULL CHECK (sfoc >= 0),
  source     text CHECK (char_length(source) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engines_code_key UNIQUE (code)
);

CREATE INDEX engines_kind_name_idx ON engines (kind, name);

-- First fuel formulas: safe expressions of speedKnot (L/min) per engine group.
CREATE TABLE fuel_formulas (
  id                       uuid PRIMARY KEY,
  code                     text CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) <= 64),
  name                     text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  main_engine_formula      text NOT NULL CHECK (char_length(main_engine_formula) BETWEEN 1 AND 500),
  auxiliary_engine_formula text NOT NULL CHECK (char_length(auxiliary_engine_formula) BETWEEN 1 AND 500),
  source                   text CHECK (char_length(source) <= 2000),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fuel_formulas_code_key UNIQUE (code)
);

-- Ports of call (legacy Port collection), WGS84 points.
CREATE TABLE ports (
  id                      uuid PRIMARY KEY,
  name                    text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  code                    text NOT NULL CHECK (code ~ '^[A-Z0-9]{2,16}$'),
  -- Indonesian administrative area code (Kemendagri kode wilayah, e.g. 51.07.03.2009).
  administrative_location text CHECK (char_length(administrative_location) <= 64),
  geom                    geography(Point, 4326) NOT NULL,
  radius_m                double precision CHECK (radius_m > 0),
  source                  text CHECK (char_length(source) <= 2000),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ports_code_key UNIQUE (code)
);

CREATE INDEX ports_geom_idx ON ports USING gist (geom);
CREATE INDEX ports_name_idx ON ports (lower(name) text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Vessels (identity shared, technical data private to the owning org, §8.5)
-- ---------------------------------------------------------------------------

CREATE TABLE vessels (
  id                       uuid PRIMARY KEY,
  -- Owning organization; NULL = platform-owned (only super_admin can write it).
  org_id                   uuid,
  mmsi                     integer NOT NULL CHECK (mmsi BETWEEN 100000000 AND 999999999),
  imo                      text CHECK (imo ~ '^[0-9]{7}$'),
  name                     text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- ISO 3166-1 alpha-2 flag state.
  flag                     text CHECK (flag ~ '^[A-Z]{2}$'),
  built_year               integer CHECK (built_year BETWEEN 1800 AND 2200),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'laid_up')),
  -- Share of the year at sea, percent (legacy generalData.annualVoyagePercentage, used by SEEMP).
  annual_voyage_percentage double precision NOT NULL CHECK (annual_voyage_percentage BETWEEN 0 AND 100),
  -- Object key of the photo in S3_BUCKET_PHOTOS.
  photo_key                text CHECK (char_length(photo_key) <= 512),
  type_id                  uuid NOT NULL REFERENCES vessel_types (id) ON DELETE RESTRICT,
  fuel_id                  uuid NOT NULL REFERENCES fuels (id) ON DELETE RESTRICT,
  first_fuel_formula_id    uuid REFERENCES fuel_formulas (id) ON DELETE RESTRICT,
  -- MongoDB ObjectId of the legacy Ship document (MVP data migration).
  legacy_id                text CHECK (char_length(legacy_id) <= 64),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vessels_mmsi_key UNIQUE (mmsi),
  CONSTRAINT vessels_imo_key UNIQUE (imo),
  CONSTRAINT vessels_legacy_id_key UNIQUE (legacy_id)
);

CREATE INDEX vessels_org_name_idx ON vessels (org_id, lower(name));
CREATE INDEX vessels_name_idx ON vessels (lower(name) text_pattern_ops);
CREATE INDEX vessels_type_idx ON vessels (type_id);
CREATE INDEX vessels_fuel_idx ON vessels (fuel_id);
CREATE INDEX vessels_formula_idx ON vessels (first_fuel_formula_id) WHERE first_fuel_formula_id IS NOT NULL;

-- Principal dimensions and Holtrop–Mennen hull coefficients (legacy ShipSize).
CREATE TABLE vessel_dimensions (
  vessel_id   uuid PRIMARY KEY REFERENCES vessels (id) ON DELETE CASCADE,
  capacity    double precision NOT NULL CHECK (capacity > 0),
  dwt         double precision CHECK (dwt >= 0),
  gt          double precision CHECK (gt >= 0),
  cb          double precision NOT NULL CHECK (cb >= 0),
  lwl         double precision NOT NULL CHECK (lwl >= 0),
  b           double precision NOT NULL CHECK (b >= 0),
  t           double precision NOT NULL CHECK (t >= 0),
  cwp         double precision NOT NULL CHECK (cwp >= 0),
  loa         double precision NOT NULL CHECK (loa >= 0),
  lpp         double precision NOT NULL CHECK (lpp >= 0),
  cp          double precision NOT NULL CHECK (cp >= 0),
  cm          double precision NOT NULL CHECK (cm >= 0),
  cbnsp       double precision NOT NULL CHECK (cbnsp >= 0),
  bulbous_bow boolean NOT NULL,
  cstern      double precision NOT NULL,
  c1          double precision NOT NULL,
  c2          double precision NOT NULL,
  c3          double precision NOT NULL,
  c5          double precision NOT NULL,
  vs          double precision NOT NULL CHECK (vs >= 0)
);

-- Engines fitted to a vessel: at most one main engine row (with its count);
-- auxiliary rows keep the order of the request (position).
CREATE TABLE vessel_engines (
  vessel_id uuid NOT NULL REFERENCES vessels (id) ON DELETE CASCADE,
  engine_id uuid NOT NULL REFERENCES engines (id) ON DELETE RESTRICT,
  role      text NOT NULL CHECK (role IN ('main', 'auxiliary')),
  quantity  integer NOT NULL CHECK (quantity BETWEEN 1 AND 64),
  position  smallint NOT NULL CHECK (position >= 0),
  PRIMARY KEY (vessel_id, engine_id, role)
);

CREATE UNIQUE INDEX vessel_engines_one_main_idx ON vessel_engines (vessel_id) WHERE role = 'main';
CREATE INDEX vessel_engines_engine_idx ON vessel_engines (engine_id);

-- Ports a vessel calls at (legacy Ship.shipPort), in request order.
CREATE TABLE vessel_ports (
  vessel_id uuid NOT NULL REFERENCES vessels (id) ON DELETE CASCADE,
  port_id   uuid NOT NULL REFERENCES ports (id) ON DELETE RESTRICT,
  position  smallint NOT NULL CHECK (position >= 0),
  PRIMARY KEY (vessel_id, port_id)
);

CREATE INDEX vessel_ports_port_idx ON vessel_ports (port_id);

-- ---------------------------------------------------------------------------
-- Registry particulars (legacy SecondaryShip): public reference data of ships
-- that are not necessarily in the fleet, imported with `pnpm registry:import`.
-- ---------------------------------------------------------------------------

CREATE TABLE registry_particulars (
  id         uuid PRIMARY KEY,
  imo        text CHECK (char_length(imo) <= 16),
  mmsi       integer NOT NULL CHECK (mmsi BETWEEN 100000000 AND 999999999),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  built      integer CHECK (built BETWEEN 1800 AND 2200),
  flag       text CHECK (char_length(flag) <= 8),
  flag_name  text CHECK (char_length(flag_name) <= 120),
  type       text CHECK (char_length(type) <= 120),
  type_name  text CHECK (char_length(type_name) <= 120),
  gt         double precision CHECK (gt >= 0),
  dwt        double precision CHECK (dwt >= 0),
  loa        double precision CHECK (loa >= 0),
  beam       double precision CHECK (beam >= 0),
  draught    double precision CHECK (draught >= 0),
  class      text CHECK (char_length(class) <= 120),
  class_code text CHECK (char_length(class_code) <= 64),
  -- The source document as imported (legacy strings), for audit and re-parsing.
  raw        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registry_particulars_mmsi_key UNIQUE (mmsi)
);

-- Search without pg_trgm (spec §6: no CREATE EXTENSION): exact and prefix
-- matches use these btree indexes; substring matches of names scan.
CREATE INDEX registry_particulars_imo_idx ON registry_particulars (imo text_pattern_ops);
CREATE INDEX registry_particulars_name_idx ON registry_particulars (lower(name) text_pattern_ops);

-- ---------------------------------------------------------------------------
-- Transactional outbox of VesselSnapshotV1 / VesselDeletedV1 (FLEET stream).
-- Columns of the kit's enqueueEvent() plus the relay's ordering and retry state.
-- ---------------------------------------------------------------------------

CREATE TABLE outbox (
  -- Envelope id = Nats-Msg-Id (deduplication of relay retries).
  id              uuid PRIMARY KEY,
  -- Commit order per vessel: writers lock the vessel row before inserting.
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  type            text NOT NULL,
  -- Envelope subject: the vessel id.
  entity_key      text,
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  published_at    timestamptz,
  -- Set for rows that can never be published (payload no longer valid).
  failed_at       timestamptz,
  CONSTRAINT outbox_seq_key UNIQUE (seq)
);

CREATE INDEX outbox_pending_idx ON outbox (seq)
  WHERE published_at IS NULL AND failed_at IS NULL;
CREATE INDEX outbox_entity_pending_idx ON outbox (entity_key, seq)
  WHERE published_at IS NULL AND failed_at IS NULL;
CREATE INDEX outbox_published_idx ON outbox (published_at)
  WHERE published_at IS NOT NULL;
