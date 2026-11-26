// Drizzle definitions of the "fleet" schema (docs/PLATFORM_SPEC.md §6, §13.3).
// The SQL files in migrations/ create the tables; these definitions MUST
// mirror them — columns, primary and foreign keys, unique constraints,
// CHECK constraints and indexes, under the names PostgreSQL gave them — and
// only type the queries. test/schema-mirror.int.test.ts compares both.
import { geography } from '@darmawanweb/ais-its-nest/db';
import { type SQL, sql } from 'drizzle-orm';
import * as pg from 'drizzle-orm/pg-core';

/** The service's PostgreSQL schema, owned by the role `fleet_svc`. */
export const serviceSchema = pg.pgSchema('fleet');

const timestamps = {
  createdAt: pg
    .timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: pg
    .timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const float = (name: string) => pg.doublePrecision(name);

/**
 * A column CHECK of the migration under the name PostgreSQL gives it
 * (`<table>_<column>_check`); `condition` is the SQL of the migration.
 */
function columnCheck(table: string, column: string, condition: SQL) {
  return pg.check(`${table}_${column}_check`, condition);
}

/** The CHECK of a reference-row `code` (lowercase snake case, ≤ 64 characters). */
const CODE_CHECK = sql`code ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(code) <= 64`;

/**
 * Ids of the methodology catalog's references (migration 0003): validated
 * against the catalog by the DTOs, bounded here.
 */
const referenceIdsColumn = () =>
  pg
    .text('reference_ids')
    .array()
    .notNull()
    .default(sql`'{}'`);

/** The CHECK of `reference_ids` (at most 20 ids). */
const REFERENCE_IDS_CHECK = sql`cardinality(reference_ids) <= 20`;

/** Ship types with CII reference-line parameters and rating vector. */
export const vesselTypes = serviceSchema.table(
  'vessel_types',
  {
    id: pg.uuid('id').primaryKey(),
    code: pg.text('code').notNull(),
    name: pg.text('name').notNull(),
    capacityUnit: pg.text('capacity_unit').$type<'DWT' | 'GT'>().notNull(),
    a: float('a').notNull(),
    c: float('c').notNull(),
    capacityFixed: float('capacity_fixed'),
    d1: float('d1').notNull(),
    d2: float('d2').notNull(),
    d3: float('d3').notNull(),
    d4: float('d4').notNull(),
    icon: pg.text('icon'),
    source: pg.text('source'),
    referenceIds: referenceIdsColumn(),
    ...timestamps,
  },
  (table) => [
    pg.unique('vessel_types_code_key').on(table.code),
    columnCheck('vessel_types', 'code', CODE_CHECK),
    columnCheck(
      'vessel_types',
      'name',
      sql`char_length(name) BETWEEN 1 AND 120`,
    ),
    columnCheck(
      'vessel_types',
      'capacity_unit',
      sql`capacity_unit IN ('DWT', 'GT')`,
    ),
    columnCheck('vessel_types', 'a', sql`a > 0`),
    columnCheck('vessel_types', 'capacity_fixed', sql`capacity_fixed > 0`),
    columnCheck('vessel_types', 'd1', sql`d1 > 0`),
    columnCheck(
      'vessel_types',
      'icon',
      sql`icon IN ('bulkca', 'combin', 'contai', 'cruise', 'gascar', 'genera', 'lngcar', 'refrig', 'ro-roc', 'ro-rop', 'ro-rov', 'tanker', 'unknown')`,
    ),
    columnCheck('vessel_types', 'source', sql`char_length(source) <= 2000`),
    columnCheck('vessel_types', 'reference_ids', REFERENCE_IDS_CHECK),
    pg.check('vessel_types_d_increasing', sql`d1 < d2 AND d2 < d3 AND d3 < d4`),
  ],
);

/** Fuels with CO2 conversion factor and density. */
export const fuels = serviceSchema.table(
  'fuels',
  {
    id: pg.uuid('id').primaryKey(),
    code: pg.text('code').notNull(),
    name: pg.text('name').notNull(),
    carbonContent: float('carbon_content').notNull(),
    conversionFactor: float('conversion_factor').notNull(),
    density: float('density').notNull(),
    source: pg.text('source'),
    referenceIds: referenceIdsColumn(),
    ...timestamps,
  },
  (table) => [
    pg.unique('fuels_code_key').on(table.code),
    columnCheck('fuels', 'code', CODE_CHECK),
    columnCheck('fuels', 'name', sql`char_length(name) BETWEEN 1 AND 120`),
    columnCheck('fuels', 'carbon_content', sql`carbon_content BETWEEN 0 AND 1`),
    columnCheck('fuels', 'conversion_factor', sql`conversion_factor > 0`),
    columnCheck('fuels', 'density', sql`density > 0`),
    columnCheck('fuels', 'source', sql`char_length(source) <= 2000`),
    columnCheck('fuels', 'reference_ids', REFERENCE_IDS_CHECK),
  ],
);

/** Engine catalogue. */
export const engines = serviceSchema.table(
  'engines',
  {
    id: pg.uuid('id').primaryKey(),
    code: pg.text('code'),
    kind: pg.text('kind').$type<'main' | 'auxiliary'>().notNull(),
    name: pg.text('name').notNull(),
    rpm: float('rpm').notNull(),
    powerKw: float('power_kw').notNull(),
    sfoc: float('sfoc').notNull(),
    source: pg.text('source'),
    referenceIds: referenceIdsColumn(),
    ...timestamps,
  },
  (table) => [
    pg.unique('engines_code_key').on(table.code),
    columnCheck('engines', 'code', CODE_CHECK),
    columnCheck('engines', 'kind', sql`kind IN ('main', 'auxiliary')`),
    columnCheck('engines', 'name', sql`char_length(name) BETWEEN 1 AND 120`),
    columnCheck('engines', 'rpm', sql`rpm >= 0`),
    columnCheck('engines', 'power_kw', sql`power_kw >= 0`),
    columnCheck('engines', 'sfoc', sql`sfoc >= 0`),
    columnCheck('engines', 'source', sql`char_length(source) <= 2000`),
    columnCheck('engines', 'reference_ids', REFERENCE_IDS_CHECK),
    pg.index('engines_kind_name_idx').on(table.kind, table.name),
  ],
);

/** First fuel formulas (safe expressions of `speedKnot`). */
export const fuelFormulas = serviceSchema.table(
  'fuel_formulas',
  {
    id: pg.uuid('id').primaryKey(),
    code: pg.text('code'),
    name: pg.text('name').notNull(),
    mainEngineFormula: pg.text('main_engine_formula').notNull(),
    auxiliaryEngineFormula: pg.text('auxiliary_engine_formula').notNull(),
    source: pg.text('source'),
    ...timestamps,
  },
  (table) => [
    pg.unique('fuel_formulas_code_key').on(table.code),
    columnCheck('fuel_formulas', 'code', CODE_CHECK),
    columnCheck(
      'fuel_formulas',
      'name',
      sql`char_length(name) BETWEEN 1 AND 120`,
    ),
    columnCheck(
      'fuel_formulas',
      'main_engine_formula',
      sql`char_length(main_engine_formula) BETWEEN 1 AND 500`,
    ),
    columnCheck(
      'fuel_formulas',
      'auxiliary_engine_formula',
      sql`char_length(auxiliary_engine_formula) BETWEEN 1 AND 500`,
    ),
    columnCheck('fuel_formulas', 'source', sql`char_length(source) <= 2000`),
  ],
);

/** Ports of call. */
export const ports = serviceSchema.table(
  'ports',
  {
    id: pg.uuid('id').primaryKey(),
    name: pg.text('name').notNull(),
    code: pg.text('code').notNull(),
    administrativeLocation: pg.text('administrative_location'),
    geom: geography('geom', { subtype: 'Point' }).notNull(),
    radiusM: float('radius_m'),
    source: pg.text('source'),
    ...timestamps,
  },
  (table) => [
    pg.unique('ports_code_key').on(table.code),
    columnCheck('ports', 'name', sql`char_length(name) BETWEEN 1 AND 120`),
    columnCheck('ports', 'code', sql`code ~ '^[A-Z0-9]{2,16}$'`),
    columnCheck(
      'ports',
      'administrative_location',
      sql`char_length(administrative_location) <= 64`,
    ),
    columnCheck('ports', 'radius_m', sql`radius_m > 0`),
    columnCheck('ports', 'source', sql`char_length(source) <= 2000`),
    pg.index('ports_geom_idx').using('gist', table.geom),
    pg
      .index('ports_name_idx')
      .using('btree', sql`lower(${table.name}) text_pattern_ops`),
  ],
);

/** Vessels of the fleet registry. */
export const vessels = serviceSchema.table(
  'vessels',
  {
    id: pg.uuid('id').primaryKey(),
    orgId: pg.uuid('org_id'),
    mmsi: pg.integer('mmsi').notNull(),
    imo: pg.text('imo'),
    name: pg.text('name').notNull(),
    flag: pg.text('flag'),
    builtYear: pg.integer('built_year'),
    status: pg
      .text('status')
      .$type<'active' | 'inactive' | 'laid_up'>()
      .notNull()
      .default('active'),
    annualVoyagePercentage: float('annual_voyage_percentage').notNull(),
    photoKey: pg.text('photo_key'),
    typeId: pg.uuid('type_id').notNull(),
    fuelId: pg.uuid('fuel_id').notNull(),
    firstFuelFormulaId: pg.uuid('first_fuel_formula_id'),
    legacyId: pg.text('legacy_id'),
    ...timestamps,
  },
  (table) => [
    pg
      .foreignKey({
        name: 'vessels_type_id_fkey',
        columns: [table.typeId],
        foreignColumns: [vesselTypes.id],
      })
      .onDelete('restrict'),
    pg
      .foreignKey({
        name: 'vessels_fuel_id_fkey',
        columns: [table.fuelId],
        foreignColumns: [fuels.id],
      })
      .onDelete('restrict'),
    pg
      .foreignKey({
        name: 'vessels_first_fuel_formula_id_fkey',
        columns: [table.firstFuelFormulaId],
        foreignColumns: [fuelFormulas.id],
      })
      .onDelete('restrict'),
    pg.unique('vessels_mmsi_key').on(table.mmsi),
    pg.unique('vessels_imo_key').on(table.imo),
    pg.unique('vessels_legacy_id_key').on(table.legacyId),
    columnCheck('vessels', 'mmsi', sql`mmsi BETWEEN 100000000 AND 999999999`),
    columnCheck('vessels', 'imo', sql`imo ~ '^[0-9]{7}$'`),
    columnCheck('vessels', 'name', sql`char_length(name) BETWEEN 1 AND 120`),
    columnCheck('vessels', 'flag', sql`flag ~ '^[A-Z]{2}$'`),
    columnCheck('vessels', 'built_year', sql`built_year BETWEEN 1800 AND 2200`),
    columnCheck(
      'vessels',
      'status',
      sql`status IN ('active', 'inactive', 'laid_up')`,
    ),
    columnCheck(
      'vessels',
      'annual_voyage_percentage',
      sql`annual_voyage_percentage BETWEEN 0 AND 100`,
    ),
    columnCheck('vessels', 'photo_key', sql`char_length(photo_key) <= 512`),
    columnCheck('vessels', 'legacy_id', sql`char_length(legacy_id) <= 64`),
    pg.index('vessels_org_name_idx').on(table.orgId, sql`lower(${table.name})`),
    pg
      .index('vessels_name_idx')
      .using('btree', sql`lower(${table.name}) text_pattern_ops`),
    pg.index('vessels_type_idx').on(table.typeId),
    pg.index('vessels_fuel_idx').on(table.fuelId),
    pg
      .index('vessels_formula_idx')
      .on(table.firstFuelFormulaId)
      .where(sql`${table.firstFuelFormulaId} IS NOT NULL`),
  ],
);

/** Principal dimensions and hull coefficients of a vessel. */
export const vesselDimensions = serviceSchema.table(
  'vessel_dimensions',
  {
    vesselId: pg.uuid('vessel_id').primaryKey(),
    capacity: float('capacity').notNull(),
    dwt: float('dwt'),
    gt: float('gt'),
    cb: float('cb').notNull(),
    lwl: float('lwl').notNull(),
    b: float('b').notNull(),
    t: float('t').notNull(),
    cwp: float('cwp').notNull(),
    loa: float('loa').notNull(),
    lpp: float('lpp').notNull(),
    cp: float('cp').notNull(),
    cm: float('cm').notNull(),
    cbnsp: float('cbnsp').notNull(),
    bulbousBow: pg.boolean('bulbous_bow').notNull(),
    cstern: float('cstern').notNull(),
    c1: float('c1').notNull(),
    c2: float('c2').notNull(),
    c3: float('c3').notNull(),
    c5: float('c5').notNull(),
    vs: float('vs').notNull(),
  },
  (table) => [
    pg
      .foreignKey({
        name: 'vessel_dimensions_vessel_id_fkey',
        columns: [table.vesselId],
        foreignColumns: [vessels.id],
      })
      .onDelete('cascade'),
    columnCheck('vessel_dimensions', 'capacity', sql`capacity > 0`),
    // Non-negative measures; cstern and the rudder factors c1..c5 are unbounded.
    ...(
      [
        'dwt',
        'gt',
        'cb',
        'lwl',
        'b',
        't',
        'cwp',
        'loa',
        'lpp',
        'cp',
        'cm',
        'cbnsp',
        'vs',
      ] as const
    ).map((column) =>
      columnCheck('vessel_dimensions', column, sql.raw(`${column} >= 0`)),
    ),
  ],
);

/** Engines fitted to a vessel. */
export const vesselEngines = serviceSchema.table(
  'vessel_engines',
  {
    vesselId: pg.uuid('vessel_id').notNull(),
    engineId: pg.uuid('engine_id').notNull(),
    role: pg.text('role').$type<'main' | 'auxiliary'>().notNull(),
    quantity: pg.integer('quantity').notNull(),
    position: pg.smallint('position').notNull(),
  },
  (table) => [
    pg.primaryKey({
      name: 'vessel_engines_pkey',
      columns: [table.vesselId, table.engineId, table.role],
    }),
    pg
      .foreignKey({
        name: 'vessel_engines_vessel_id_fkey',
        columns: [table.vesselId],
        foreignColumns: [vessels.id],
      })
      .onDelete('cascade'),
    pg
      .foreignKey({
        name: 'vessel_engines_engine_id_fkey',
        columns: [table.engineId],
        foreignColumns: [engines.id],
      })
      .onDelete('restrict'),
    columnCheck('vessel_engines', 'role', sql`role IN ('main', 'auxiliary')`),
    columnCheck('vessel_engines', 'quantity', sql`quantity BETWEEN 1 AND 64`),
    columnCheck('vessel_engines', 'position', sql`position >= 0`),
    // At most one main-engine row per vessel (its count is `quantity`).
    pg
      .uniqueIndex('vessel_engines_one_main_idx')
      .on(table.vesselId)
      .where(sql`${table.role} = 'main'`),
    pg.index('vessel_engines_engine_idx').on(table.engineId),
  ],
);

/** Ports a vessel calls at. */
export const vesselPorts = serviceSchema.table(
  'vessel_ports',
  {
    vesselId: pg.uuid('vessel_id').notNull(),
    portId: pg.uuid('port_id').notNull(),
    position: pg.smallint('position').notNull(),
  },
  (table) => [
    pg.primaryKey({
      name: 'vessel_ports_pkey',
      columns: [table.vesselId, table.portId],
    }),
    pg
      .foreignKey({
        name: 'vessel_ports_vessel_id_fkey',
        columns: [table.vesselId],
        foreignColumns: [vessels.id],
      })
      .onDelete('cascade'),
    pg
      .foreignKey({
        name: 'vessel_ports_port_id_fkey',
        columns: [table.portId],
        foreignColumns: [ports.id],
      })
      .onDelete('restrict'),
    columnCheck('vessel_ports', 'position', sql`position >= 0`),
    pg.index('vessel_ports_port_idx').on(table.portId),
  ],
);

/** Registry particulars (legacy SecondaryShip). */
export const registryParticulars = serviceSchema.table(
  'registry_particulars',
  {
    id: pg.uuid('id').primaryKey(),
    imo: pg.text('imo'),
    mmsi: pg.integer('mmsi').notNull(),
    name: pg.text('name').notNull(),
    built: pg.integer('built'),
    flag: pg.text('flag'),
    flagName: pg.text('flag_name'),
    type: pg.text('type'),
    typeName: pg.text('type_name'),
    gt: float('gt'),
    dwt: float('dwt'),
    loa: float('loa'),
    beam: float('beam'),
    draught: float('draught'),
    class: pg.text('class'),
    classCode: pg.text('class_code'),
    raw: pg.jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    pg.unique('registry_particulars_mmsi_key').on(table.mmsi),
    columnCheck('registry_particulars', 'imo', sql`char_length(imo) <= 16`),
    columnCheck(
      'registry_particulars',
      'mmsi',
      sql`mmsi BETWEEN 100000000 AND 999999999`,
    ),
    columnCheck(
      'registry_particulars',
      'name',
      sql`char_length(name) BETWEEN 1 AND 200`,
    ),
    columnCheck(
      'registry_particulars',
      'built',
      sql`built BETWEEN 1800 AND 2200`,
    ),
    columnCheck('registry_particulars', 'flag', sql`char_length(flag) <= 8`),
    columnCheck(
      'registry_particulars',
      'flag_name',
      sql`char_length(flag_name) <= 120`,
    ),
    columnCheck('registry_particulars', 'type', sql`char_length(type) <= 120`),
    columnCheck(
      'registry_particulars',
      'type_name',
      sql`char_length(type_name) <= 120`,
    ),
    ...(['gt', 'dwt', 'loa', 'beam', 'draught'] as const).map((column) =>
      columnCheck('registry_particulars', column, sql.raw(`${column} >= 0`)),
    ),
    columnCheck(
      'registry_particulars',
      'class',
      sql`char_length(class) <= 120`,
    ),
    columnCheck(
      'registry_particulars',
      'class_code',
      sql`char_length(class_code) <= 64`,
    ),
    // Search without pg_trgm: exact and prefix matches of IMO numbers and names.
    pg
      .index('registry_particulars_imo_idx')
      .on(table.imo.op('text_pattern_ops')),
    pg
      .index('registry_particulars_name_idx')
      .using('btree', sql`lower(${table.name}) text_pattern_ops`),
  ],
);

/** Transactional outbox of the FLEET stream. */
export const outbox = serviceSchema.table(
  'outbox',
  {
    id: pg.uuid('id').primaryKey(),
    seq: pg.bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    type: pg.text('type').notNull(),
    entityKey: pg.text('entity_key'),
    data: pg.jsonb('data').notNull(),
    createdAt: pg
      .timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: pg.integer('attempts').notNull().default(0),
    nextAttemptAt: pg
      .timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: pg.text('last_error'),
    publishedAt: pg.timestamp('published_at', { withTimezone: true }),
    failedAt: pg.timestamp('failed_at', { withTimezone: true }),
  },
  (table) => [
    pg.unique('outbox_seq_key').on(table.seq),
    // Claims of the kit's per-key relay: the pending rows in seq order, and
    // per vessel (names of the kit's outbox DDL, migration 0002).
    pg
      .index('outbox_pending_seq_idx')
      .on(table.seq)
      .where(sql`published_at IS NULL AND failed_at IS NULL`),
    pg
      .index('outbox_pending_key_idx')
      .on(table.entityKey, table.seq)
      .where(sql`published_at IS NULL AND failed_at IS NULL`),
    // Parked rows (aisits_outbox_failed_rows).
    pg
      .index('outbox_failed_idx')
      .on(table.failedAt)
      .where(sql`failed_at IS NOT NULL`),
    // Retention cleanup of published rows.
    pg
      .index('outbox_published_idx')
      .on(table.publishedAt)
      .where(sql`published_at IS NOT NULL`),
  ],
);
