// Drizzle definitions of the "fleet" schema (docs/PLATFORM_SPEC.md §6, §13.3).
// The SQL files in migrations/ create the tables; these definitions MUST
// mirror them and only type the queries.
import { geography } from '@darmawanweb/ais-its-nest/db';
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
    ...timestamps,
  },
  (table) => [pg.unique('vessel_types_code_key').on(table.code)],
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
    ...timestamps,
  },
  (table) => [pg.unique('fuels_code_key').on(table.code)],
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
    ...timestamps,
  },
  (table) => [
    pg.unique('engines_code_key').on(table.code),
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
  (table) => [pg.unique('fuel_formulas_code_key').on(table.code)],
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
  (table) => [pg.unique('ports_code_key').on(table.code)],
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
    typeId: pg
      .uuid('type_id')
      .notNull()
      .references(() => vesselTypes.id, { onDelete: 'restrict' }),
    fuelId: pg
      .uuid('fuel_id')
      .notNull()
      .references(() => fuels.id, { onDelete: 'restrict' }),
    firstFuelFormulaId: pg
      .uuid('first_fuel_formula_id')
      .references(() => fuelFormulas.id, { onDelete: 'restrict' }),
    legacyId: pg.text('legacy_id'),
    ...timestamps,
  },
  (table) => [
    pg.unique('vessels_mmsi_key').on(table.mmsi),
    pg.unique('vessels_imo_key').on(table.imo),
    pg.unique('vessels_legacy_id_key').on(table.legacyId),
    pg.index('vessels_type_idx').on(table.typeId),
    pg.index('vessels_fuel_idx').on(table.fuelId),
  ],
);

/** Principal dimensions and hull coefficients of a vessel. */
export const vesselDimensions = serviceSchema.table('vessel_dimensions', {
  vesselId: pg
    .uuid('vessel_id')
    .primaryKey()
    .references(() => vessels.id, { onDelete: 'cascade' }),
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
});

/** Engines fitted to a vessel. */
export const vesselEngines = serviceSchema.table(
  'vessel_engines',
  {
    vesselId: pg
      .uuid('vessel_id')
      .notNull()
      .references(() => vessels.id, { onDelete: 'cascade' }),
    engineId: pg
      .uuid('engine_id')
      .notNull()
      .references(() => engines.id, { onDelete: 'restrict' }),
    role: pg.text('role').$type<'main' | 'auxiliary'>().notNull(),
    quantity: pg.integer('quantity').notNull(),
    position: pg.smallint('position').notNull(),
  },
  (table) => [
    pg.primaryKey({ columns: [table.vesselId, table.engineId, table.role] }),
    pg.index('vessel_engines_engine_idx').on(table.engineId),
  ],
);

/** Ports a vessel calls at. */
export const vesselPorts = serviceSchema.table(
  'vessel_ports',
  {
    vesselId: pg
      .uuid('vessel_id')
      .notNull()
      .references(() => vessels.id, { onDelete: 'cascade' }),
    portId: pg
      .uuid('port_id')
      .notNull()
      .references(() => ports.id, { onDelete: 'restrict' }),
    position: pg.smallint('position').notNull(),
  },
  (table) => [
    pg.primaryKey({ columns: [table.vesselId, table.portId] }),
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
  (table) => [pg.unique('registry_particulars_mmsi_key').on(table.mmsi)],
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
  (table) => [pg.unique('outbox_seq_key').on(table.seq)],
);
