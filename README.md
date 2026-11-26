# ais-its-fleet-service

Vessel master data and reference data of **AIS Maritime Intelligence** v2: vessels with their
dimensions, engines, ports of call and photos; ship types with their CII parameters, fuels, engines,
first fuel formulas and ports; registry particulars of ships outside the fleet. It is the producer
of the `FLEET` stream: every change publishes the vessel's `VesselSnapshotV1` through a
transactional outbox.

Service `fleet` (port **3002**, PostgreSQL schema `fleet`, image
`ghcr.io/darmawanweb/ais-its-fleet-service`), NestJS 12 + Fastify on the platform kit
[`@darmawanweb/ais-its-nest`](https://github.com/DarmawanWeb/ais-its-contracts/tree/main/packages/nest)
0.3 and the contracts [`@darmawanweb/ais-its-contracts`](https://github.com/DarmawanWeb/ais-its-contracts)
0.4 (changes: [`CHANGELOG.md`](CHANGELOG.md)).
The normative engineering spec is [`docs/PLATFORM_SPEC.md`](../../docs/PLATFORM_SPEC.md) §13.3 in
the central repository ([`ais-its-platform`](https://github.com/DarmawanWeb/ais-its-platform)).

- [Purpose and responsibilities](#purpose-and-responsibilities)
- [Architecture](#architecture)
- [Data model](#data-model)
- [API](#api)
- [Events](#events)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Testing](#testing)
- [Operations](#operations)
- [Seeds and data provenance](#seeds-and-data-provenance)
- [Legacy parity](#legacy-parity)
- [Known limitations](#known-limitations)
- [Methodology & references](#methodology--references)

## Purpose and responsibilities

- **Vessels** — identity (MMSI, IMO, name, flag, type, status, photo), voyage share, principal
  dimensions and hull coefficients, fitted engines, ports of call, fuel and first fuel formula.
  Vessels are addressable by id and by MMSI.
- **Tenancy** (spec §8.5) — the identity of a vessel is shared with every principal holding
  `vessel:read` (`VesselSummaryDto`); its technical data only with the owning organization and
  platform administrators (`VesselDetailDto`). Organization members create vessels in their active
  organization only; `super_admin` may set any `orgId` (or none: platform-owned).
- **Reference data** (global, written with `reference:write` = `super_admin`): ship types with
  the CII reference line `a`, `c`, the rating vector `d1..d4` and the regulation-fixed capacity,
  fuels (Cf, carbon content, density), main and auxiliary engines, first fuel formulas (validated
  against the safe expression grammar shared with emission), ports (GeoJSON points). Ship types,
  fuels and engines cite the methodology catalog's references (`referenceIds`); platform
  administrators see how many vessels use each row (`vesselCount`).
- **Registry particulars** — public ship particulars (legacy `SecondaryShip`) imported with
  `pnpm registry:import`, searchable by name, IMO number and MMSI.
- **Photos** — JPEG/PNG/WebP up to 5 MB in S3 (bucket `vessel-photos`), served to browsers by
  presigned URLs (1 h).
- **Snapshot publication** — `VesselSnapshotV1` on `fleet.vessel.v1.<vesselId>` for every vessel
  change and for every vessel affected by a reference-data change; tombstones on delete;
  republication on demand and on boot.
- **Audit** — `audit.recorded.v1` for every write (`vessel.create`, `fuel.update`, …).

Not here: AIS positions (ais-pipeline), fuel readings (telemetry), CII/SEEMP computations (emission —
it consumes the snapshots), users and organizations (auth).

## Architecture

```mermaid
flowchart LR
  web[Web app / API clients] -->|/api/v2/vessels, /vessel-types, /fuels,<br/>/engines, /fuel-formulas, /ports, /registry| gw[Traefik gateway]
  gw --> http
  subgraph fleet[fleet service :3002]
    http[Controllers<br/>DTO validation, permissions] --> svc[Services<br/>tenancy, use cases]
    svc --> repo[Repositories<br/>drizzle]
    svc --> outboxw[SnapshotOutbox<br/>same transaction]
    svc --> storage[PhotoStorage]
    relay[OutboxRelay of the kit<br/>per key, FOR UPDATE SKIP LOCKED,<br/>per-row backoff, metrics]
    republish[RepublishService<br/>FLEET_REPUBLISH_ON_BOOT]
    domain[(domain/<br/>pure functions)]
    svc -.-> domain
  end
  repo --> pg[(PostgreSQL schema fleet<br/>vessels, reference data,<br/>registry_particulars)]
  outboxw --> outbox[(fleet.outbox)]
  republish --> outbox
  relay -->|claim| outbox
  relay -->|fleet.vessel.upserted.v1 / deleted.v1<br/>Nats-Msg-Id = outbox id| nats[(NATS JetStream<br/>stream FLEET)]
  svc -->|audit.recorded.v1| nats
  storage -->|put / delete / presign| s3[(S3 / RustFS<br/>bucket vessel-photos)]
  nats --> consumers[emission-fleet, safety-fleet, surveillance-fleet,<br/>notification-fleet, telemetry-fleet, ais-processor-fleet]
  web -.->|presigned GET (S3_PUBLIC_ENDPOINT)| s3
```

```text
src/
  main.ts, server.ts         bootstrap via the kit (telemetry first, then the app)
  config.ts                  zod env schema (base schema + S3, outbox, republish)
  app.module.ts              DatabaseModule, NatsModule(FLEET), AuthModule, AuditModule, features
  domain/                    pure functions: snapshot mapping, formula problem codes, list sort
                             keys, tenancy rules, engine assignment rules, photo magic bytes,
                             registry parsing
  modules/vessels/           vessels, dimensions, engines, ports, photos, republish
  modules/{vessel-types,fuels,engines,fuel-formulas,ports}/   reference data CRUD + cascades
  modules/registry/          registry search and lookup, legacy importer
  modules/snapshots/         aggregate loader, outbox writer, relay options (kit OutboxModule),
                             republish, reference usage counts, metrics
  modules/storage/           S3 client (bucket ensured after bootstrap)
  modules/methodology/       GET /api/v2/fleet/methodology
  seeds/                     IMO ship types, fuels, case-study engines/formula/ports
  seed.ts, registry-import.ts, migrate.ts, openapi.ts   CLIs
migrations/                  forward-only: 0001_init.sql (schema), 0002_outbox_kit_indexes.sql,
                             0003_reference_ids.sql
```

Every write runs in one transaction that locks the vessel row (`FOR UPDATE`), applies the change,
advances `vessels.updated_at` with `clock_timestamp()` and inserts the new snapshot into
`fleet.outbox`; audit records, metrics and S3 deletions follow the commit. A reference-data change
locks every vessel that embeds the row, advances their `updated_at` and enqueues all their
snapshots in the transaction of the change; a change of members the snapshots do not embed only
(`source`, `referenceIds`, a ship type's `icon`, an engine's `code`, a formula's `name`/`code`)
republishes nothing. Deadlocks between the two orders are re-run (`TRANSACTION_RETRIES = 3`:
`src/db/database.ts#inTransaction` uses the kit's `withTransaction({ retries })`, which finds the
SQLSTATE behind drizzle's `DrizzleQueryError` since kit 0.3, and logs each re-run). A kind change of an
engine locks the engine row (`FOR UPDATE`) before counting the vessels fitted with it, so it can
never race a vessel write that fits the engine in its old role.

Startup follows the kit's lifecycle rule: connect, migrate and ensure the `FLEET` (and `AUDIT`)
streams in `onModuleInit` → start the outbox relay (the kit's `OutboxRelay`, per-key mode), the
optional boot republish and the bucket check in `onApplicationBootstrap` → the port opens. The
migrations are read from the package (`MIGRATIONS_DIR` of `src/service.ts`), whatever the working
directory. On `SIGTERM` readiness turns `503`, the relay
finishes its pass, NATS drains and the pool closes. `pnpm openapi` builds the app without opening
any connection.

## Data model

All tables live in schema `fleet` (owner `fleet_svc`); measurements are `double precision`, enums
`text` + `CHECK`, ids UUID v7 generated in the application.

| Table                  | Key columns                                                                                                                                                                                                                                                         | Notes                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vessel_types`         | `code` unique, `capacity_unit` (`DWT`\|`GT`), `a`, `c`, `capacity_fixed`, `d1 < d2 < d3 < d4`, `icon`, `source`, `reference_ids`                                                                                                                                    | CII reference line `CII_ref = a · Capacity^(−c)`; `capacity_fixed` = regulation-fixed capacity of a size band (e.g. 279 000 DWT), `NULL` = the vessel's own capacity            |
| `fuels`                | `code` unique, `carbon_content` (0..1), `conversion_factor` (Cf, t CO2/t fuel), `density` (t/m³ = kg/L), `source`, `reference_ids`                                                                                                                                  |                                                                                                                                                                                 |
| `engines`              | `kind` (`main`\|`auxiliary`), `name`, `rpm`, `power_kw`, `sfoc` (g/kWh), optional `code` (seed key), `source`, `reference_ids`                                                                                                                                      |                                                                                                                                                                                 |
| `fuel_formulas`        | `name`, `main_engine_formula`, `auxiliary_engine_formula` (≤ 500 chars, safe grammar), optional `code`                                                                                                                                                              | strings evaluated by the emission service                                                                                                                                       |
| `ports`                | `code` unique (`[A-Z0-9]{2,16}`), `name`, `administrative_location`, `geom geography(Point,4326)` (GiST), `radius_m`                                                                                                                                                | GeoJSON point in/out                                                                                                                                                            |
| `vessels`              | `org_id` (`NULL` = platform-owned), `mmsi` unique, `imo` unique, `name`, `flag` (ISO alpha-2), `built_year`, `status` (`active`\|`inactive`\|`laid_up`), `annual_voyage_percentage`, `photo_key`, `type_id`, `fuel_id`, `first_fuel_formula_id`, `legacy_id` unique | references are `ON DELETE RESTRICT`                                                                                                                                             |
| `vessel_dimensions`    | `vessel_id` PK, `capacity`, `dwt`, `gt`, `cb`, `lwl`, `b`, `t`, `cwp`, `loa`, `lpp`, `cp`, `cm`, `cbnsp`, `bulbous_bow`, `cstern`, `c1`, `c2`, `c3`, `c5`, `vs`                                                                                                     | see [field meanings](#dimensions-and-hull-coefficients)                                                                                                                         |
| `vessel_engines`       | PK `(vessel_id, engine_id, role)`, `quantity` 1..64, `position`                                                                                                                                                                                                     | at most one main row (partial unique index)                                                                                                                                     |
| `vessel_ports`         | PK `(vessel_id, port_id)`, `position`                                                                                                                                                                                                                               | ordered ports of call                                                                                                                                                           |
| `registry_particulars` | `mmsi` unique, `imo`, `name`, `built`, `flag`, `flag_name`, `type`, `type_name`, `gt`, `dwt`, `loa`, `beam`, `draught`, `class`, `class_code`, `raw jsonb`                                                                                                          | legacy `SecondaryShip`; btree `text_pattern_ops` indexes on `lower(name)` and `imo` (no `pg_trgm`: services may not create extensions), see [registry search](#registry-search) |
| `outbox`               | `id` (= envelope id = `Nats-Msg-Id`), `seq` identity, `type`, `entity_key` (vessel id), `data`, `attempts`, `next_attempt_at`, `last_error`, `published_at`, `failed_at`                                                                                            | the kit's per-key layout (index names of its DDL since 0002); published rows purged after `OUTBOX_RETENTION_HOURS`                                                              |
| `schema_migrations`    | `version`, `name`, `checksum`, `applied_at`                                                                                                                                                                                                                         | kit migrator                                                                                                                                                                    |

`reference_ids` (`text[]`, at most 20, migration 0003) holds ids of the methodology catalog's
references (`docs/references/references.json`), validated against the catalog contracts ships
(`REFERENCES`) on every write, next to the free-text `source`.

[`src/db/schema.ts`](src/db/schema.ts) mirrors the migration (spec §6) column by column, with every
primary key, foreign key, unique and `CHECK` constraint and every index (method, uniqueness,
predicate) under the name PostgreSQL gave it; `test/schema-mirror.int.test.ts` compares it with the
migrated database.

### Dimensions and hull coefficients

Legacy `ShipSize` fields (MongoDB) map to `vessel_dimensions` / `VesselSnapshotV1.dimensions`
(lengths in m, speed in kn, coefficients dimensionless). They feed the CII capacity and the
Holtrop–Mennen resistance chain of the emission service ([METHODOLOGY §7.3](../../docs/METHODOLOGY.md)).

| Snapshot field         | Legacy field | Meaning                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capacity`             | `capacity`   | CII capacity: DWT or GT according to the ship type's `capacityUnit` (replaced by `type.capacityFixed` when set)                                                                                                                                                                                                                                                               |
| `dwt` / `gt`           | `dwt` / —    | deadweight (t) / gross tonnage, informative                                                                                                                                                                                                                                                                                                                                   |
| `cb`                   | `cb`         | block coefficient C_B = ∇ / (L·B·T)                                                                                                                                                                                                                                                                                                                                           |
| `lwl`                  | `lwl`        | length on the waterline L_WL                                                                                                                                                                                                                                                                                                                                                  |
| `b`                    | `b`          | moulded breadth B                                                                                                                                                                                                                                                                                                                                                             |
| `t`                    | `t`          | draught T                                                                                                                                                                                                                                                                                                                                                                     |
| `cwp`                  | `cwp`        | waterplane area coefficient C_WP = A_WP / (L_WL·B)                                                                                                                                                                                                                                                                                                                            |
| `loa`                  | `loa`        | length overall LOA                                                                                                                                                                                                                                                                                                                                                            |
| `lpp`                  | `lpp`        | length between perpendiculars L_PP                                                                                                                                                                                                                                                                                                                                            |
| `cp`                   | `cp`         | prismatic coefficient C_P = C_B / C_M                                                                                                                                                                                                                                                                                                                                         |
| `cm`                   | `cm`         | midship section coefficient C_M = A_M / (B·T)                                                                                                                                                                                                                                                                                                                                 |
| `cbnsp`                | `cbnsp`      | block coefficient used by the legacy displacement Δ = L_m·B·T·C_bnsp·1.025, L_m = (L_WL + L_PP)/2 (thesis definition open, METHODOLOGY §7.3.1)                                                                                                                                                                                                                                |
| `bulbousBow`           | `bulbosbow`  | bulbous bow fitted; the legacy uses it as the bulb area A_BT ∈ {0, 1} m²                                                                                                                                                                                                                                                                                                      |
| `cstern`               | `cstern`     | Holtrop afterbody (stern shape) coefficient C_stern (−25 … +10)                                                                                                                                                                                                                                                                                                               |
| `c1`, `c2`, `c3`, `c5` | same         | factors of the class rule for the minimum rudder area A = c1·c2·c3·c4·1.75·L·T/100 that the legacy uses as appendage area: c1 ship type (1.0 general, 0.9 bulk/tanker, 1.7 tug/trawler), c2 rudder type, c3 rudder profile (also reused as the Holtrop bulb coefficient in c2 = exp(−1.89·√c3)), c5 rudder arrangement (the rule's c4: 1.0 in the propeller jet, 1.5 outside) |
| `vs`                   | `vs`         | service speed V_S, kn                                                                                                                                                                                                                                                                                                                                                         |

## API

All routes are under `/api/v2` except health, metrics and docs; errors are RFC 9457 problem
details (`application/problem+json`) with a stable `code`. OpenAPI: `GET /docs`, `GET /openapi.json`,
committed [`openapi.json`](openapi.json).

| Method                | Path                                                                  | Permission                                                            | Notes                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                   | `/vessels?search&typeCode&orgId&status&mmsi&sort&order&page&pageSize` | `vessel:read`                                                         | page-based; detail view for own org, summary for others; `orgId` of another org only for `super_admin`; `mmsi` lookup and `sort`, see [vessel lists](#vessel-lists) |
| POST                  | `/vessels`                                                            | `vessel:write`                                                        | in the active org; `orgId`/`legacyId` only for `super_admin`; optional `engines`, `portIds`                                                                         |
| GET                   | `/vessels/:id`, `/vessels/by-mmsi/:mmsi`                              | `vessel:read`                                                         | `VesselDetailDto` or `VesselSummaryDto` (discriminator `view`)                                                                                                      |
| PATCH                 | `/vessels/:id`                                                        | `vessel:write`, own org                                               | identity, status, voyage share, type/fuel/formula; `orgId` only `super_admin`                                                                                       |
| DELETE                | `/vessels/:id`                                                        | `vessel:write`, own org                                               | tombstone `fleet.vessel.deleted.v1`, photo object removed                                                                                                           |
| PUT                   | `/vessels/:id/dimensions`                                             | `vessel:write`, own org                                               | full replacement                                                                                                                                                    |
| PUT                   | `/vessels/:id/engines`                                                | `vessel:write`, own org                                               | `[{ engineId, role, quantity }]`, ≤ 16 rows, one main row                                                                                                           |
| PUT                   | `/vessels/:id/ports`                                                  | `vessel:write`, own org                                               | `[portId]` in order, unique, ≤ 50                                                                                                                                   |
| POST                  | `/vessels/:id/photo`                                                  | `vessel:write`, own org                                               | multipart field `file`, ≤ 5 MB, JPEG/PNG/WebP by magic bytes → `201` detail                                                                                         |
| DELETE                | `/vessels/:id/photo`                                                  | `vessel:write`, own org                                               | removes the S3 object                                                                                                                                               |
| POST                  | `/vessels/:id/republish`                                              | `super_admin` (`@RequirePlatformAdmin()`, OpenAPI `x-required-roles`) | `202 { vesselId, enqueued }`; everybody else `403 PLATFORM_ADMIN_REQUIRED`                                                                                          |
| GET                   | `/vessel-types`, `/vessel-types/:id`                                  | `vessel:read`                                                         | `?search&page&pageSize`                                                                                                                                             |
| POST / PATCH / DELETE | `/vessel-types`, `/vessel-types/:id`                                  | `reference:write`                                                     | PATCH of an embedded member republishes every vessel of the type                                                                                                    |
| GET                   | `/fuels`, `/fuels/:id`                                                | `vessel:read`                                                         |                                                                                                                                                                     |
| POST / PATCH / DELETE | `/fuels`, `/fuels/:id`                                                | `reference:write`                                                     | PATCH of an embedded member republishes every vessel burning the fuel                                                                                               |
| GET                   | `/engines?kind=main\|auxiliary`, `/engines/:id`                       | `vessel:read`                                                         |                                                                                                                                                                     |
| POST / PATCH / DELETE | `/engines`, `/engines/:id`                                            | `reference:write`                                                     | PATCH of an embedded member republishes every vessel fitted with it                                                                                                 |
| GET                   | `/fuel-formulas`, `/fuel-formulas/:id`                                | `vessel:read`                                                         |                                                                                                                                                                     |
| POST                  | `/fuel-formulas/validate`                                             | `vessel:read`                                                         | `200 { valid, problem }` against the server grammar, nothing stored, see [the grammar](#safe-first-fuel-formula-grammar)                                            |
| POST / PATCH / DELETE | `/fuel-formulas`, `/fuel-formulas/:id`                                | `reference:write`                                                     | formulas validated on write; a formula change republishes its vessels                                                                                               |
| GET                   | `/ports?bbox=minLon,minLat,maxLon,maxLat&search`, `/ports/:id`        | `vessel:read`                                                         | `location` GeoJSON `Point`                                                                                                                                          |
| POST / PATCH / DELETE | `/ports`, `/ports/:id`                                                | `reference:write`                                                     | snapshots carry port ids only: no republish                                                                                                                         |
| GET                   | `/registry/search?q&match=auto\|prefix\|contains&page&pageSize`       | `vessel:read`                                                         | name, IMO and MMSI over indexes, see [registry search](#registry-search)                                                                                            |
| GET                   | `/registry/:imoOrMmsi`                                                | `vessel:read`                                                         | 9 digits = MMSI, 7 digits or `IMO1234567` = IMO                                                                                                                     |
| GET                   | `/fleet/methodology`                                                  | any signed-in user                                                    | methods implemented here (§17); the gateway does not route `/api/v2/fleet` yet (spec §12)                                                                           |
| GET                   | `/health/live`, `/health/ready`, `/metrics`, `/docs`, `/openapi.json` | public (not routed by the gateway)                                    |                                                                                                                                                                     |

Deleting a reference row still used by a vessel is `409 REFERENCE_IN_USE`. For principals with
`reference:write` (platform administrators) every reference row (list and `GET /:id`) carries
`vesselCount`, the vessels of every organization that use it (one grouped count per page), so a
client can disable delete and show "used by N vessels"; other principals get the rows without it,
because the count spans every tenant's technical data (spec §8.5). Ship types, fuels and engines
carry `referenceIds` (create, PATCH, output; `[]` clears, `null` and ids outside the catalog are
`400`).

- **PATCH bodies** accept any subset of the create fields. `null` clears a nullable member only —
  vessels `imo`, `flag`, `builtYear`, `firstFuelFormulaId`; vessel types `capacityFixed`, `icon`,
  `source`; engines and fuel formulas `code`, `source`; fuels `source`; ports
  `administrativeLocation`, `radiusM`, `source` — and is `400 VALIDATION_FAILED` on the field for
  every other member, `referenceIds` included (`PatchType` in `src/modules/common/validation.ts`,
  the kit's `@IsOptionalNotNull()`). Optional create members
  that are not nullable (`status`, `engines`, `portIds`, `orgId`, `legacyId`) refuse `null` too. As a
  second safeguard a PostgreSQL NOT NULL violation is answered `400 VALIDATION_FAILED` (and logged
  as a warning) instead of `500`.
- **Pages**: `page` 1–1 000 000, `pageSize` 1–100 (default 20) on every list (the kit's
  `PageQueryDto`, `MAX_PAGE`, documented as the `maximum` in OpenAPI).
- **Path parameters**: `:mmsi` must be exactly nine digits forming a valid MMSI; anything else
  (`12`, `-5`, `1e5`, `0525005223`, values beyond `integer`) is `400 VALIDATION_FAILED` on `mmsi`,
  never `404`/`500`; a malformed `:id` is `400 VALIDATION_FAILED` on `id`. Both read the raw path
  segment (the kit's `@MmsiParam()` / `@UuidParam()`) and are documented in OpenAPI
  (`pattern: ^[0-9]{9}$`, `format: uuid`).

### Vessel lists

`GET /vessels` filters by `search`, `typeCode`, `orgId`, `status` and, as a **batch identity
lookup**, `mmsi=525005223,525005224` (1–100 MMSIs, comma-separated or a repeated parameter; unknown
ones are simply absent; pass a `pageSize` of at least their number). Each vessel comes in the view
the principal may see, so one request names every vessel of an alert or event list (identity
`id`, `mmsi`, `imo`, `name`, `flag`, `type`, `status`, `photoUrl` for every tenant, spec §8.5).

`sort=name|mmsi|imo|gt|dwt|builtYear|updatedAt` (default `name`) and `order=asc|desc` (default
`asc`) sort server-side; ties fall back to name, then id, so pages are stable; vessels without a
value come last in both directions. `gt`, `dwt` and `builtYear` are **technical data**: their
values order only the vessels whose detail view the principal receives (its organization's; every
vessel for platform administrators), the others follow by name as if the value were unknown — a
sort never reveals how foreign vessels compare
([`src/domain/vessel-list.ts`](src/domain/vessel-list.ts), `orderOf` in
[`vessels.repository.ts`](src/modules/vessels/vessels.repository.ts)). Last-seen positions and CII
grades are not vessel master data: they come from ais-pipeline and emission (see
[known limitations](#known-limitations)).

### Registry search

`GET /registry/search?q=` matches without trigram indexes (spec §6 forbids `CREATE EXTENSION`). Each
arm is its own `UNION ALL` branch, so PostgreSQL answers it with an index range scan
([`registrySearchSql`](src/modules/registry/registry.repository.ts)):

| Arm                                | Predicate                         | Index                           | Rank  |
| ---------------------------------- | --------------------------------- | ------------------------------- | ----- |
| name prefix                        | `lower(name) LIKE 'q%'`           | `registry_particulars_name_idx` | 0 / 1 |
| IMO prefix (1–7 digits, `IMO…`)    | `imo LIKE 'digits%'`              | `registry_particulars_imo_idx`  | 0 / 1 |
| MMSI range (1–9 digits)            | `mmsi BETWEEN digits·10^k AND …9` | `registry_particulars_mmsi_key` | 0 / 1 |
| substring (text of ≥ 3 characters) | `name ILIKE '%q%'`                | none — sequential scan          | 2     |

Exact matches (name, IMO number, 9-digit MMSI) rank 0, prefix matches 1, substring matches 2; then
name and MMSI. An entry matched by several arms appears once with its best rank, and the total is
counted from the same set. Numeric queries are identity lookups and never run the substring arm.
`match` decides the substring arm for text queries: `prefix` never, `contains` always, `auto` (the
default) only when the indexed arms match fewer entries than `pageSize` — a decision that depends
on the query and the page size only, so every page reports the same `total`.
`test/registry.int.test.ts` checks the plans (`EXPLAIN`) on 20 000 rows.

### Safe first-fuel-formula grammar

`fuel_formulas.main_engine_formula` / `auxiliary_engine_formula` are parsed on every write with
the grammar shared with the emission service, contracts `validateFuelFormula` / `parseFuelFormula`
(`@darmawanweb/ais-its-contracts/domain` 0.4, recursive descent, never `eval` / `new Function`;
`IsFuelFormula` in [`src/modules/common/validation.ts`](src/modules/common/validation.ts)):

```text
formula  = sum
sum      = product { ("+" | "-") product }
product  = unary { ("*" | "/") unary }
unary    = ("+" | "-") unary | power
power    = primary [ ("**" | "^") unary ]            right-associative; ^ means power (spec §15.4)
primary  = number | "speedKnot" | call | "(" sum ")"
call     = [ "Math." ] ( exp | log | ln | sqrt | pow | abs | min | max ) "(" sum { "," sum } ")"
```

Anything else (`process.exit(1)`, `Math.random()`, `speed`, `;`, quotes, `%`, wrong arity, more
than 500 characters, more than 32 nesting levels — parentheses, calls, signs and exponents, each
`^`/`**` one level deeper as in the emission evaluator — or a non-finite number such as `1e999`) is
`400 VALIDATION_FAILED` with the field and the position of the problem (`FUEL_FORMULA_LIMITS`:
500 characters, depth 32, 500 tokens). Contracts took over the service's own parser of 0.1 with the
same limits, messages and positions; [`fuel-formula.spec.ts`](src/domain/fuel-formula.spec.ts) keeps
the 0.1 tests and the corpus of emission's former verdicts as regression tests of the shared
grammar, so a formula stored before the upgrade still validates.

`POST /fuel-formulas/validate { formula }` (`vessel:read`, at most 2 000 characters) lets an editor
check a formula against the same grammar without storing anything: always `200`,
`{ valid: true, problem: null }` or `{ valid: false, problem: { code, message, position, token } }`
with the first problem. `code` is stable for localized messages
([`src/domain/fuel-formula-problem.ts`](src/domain/fuel-formula-problem.ts)): `EMPTY_FORMULA`,
`FORMULA_TOO_LONG`, `TOO_MANY_TOKENS`, `NESTED_TOO_DEEPLY`, `UNEXPECTED_CHARACTER`,
`NUMBER_OUT_OF_RANGE`, `UNKNOWN_IDENTIFIER`, `WRONG_ARGUMENT_COUNT`, `EXPECTED_TOKEN`,
`UNEXPECTED_END`, `UNEXPECTED_TOKEN` (`SYNTAX_ERROR` for wording a later contracts release adds);
`token` is the text at `position` (`null` at the end of the formula and for the length problems).
Clients on contracts ≥ 0.4 can run `validateFuelFormula` locally instead.

### Error codes

| Status | Code                                                                                                                                                                         | When                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_FAILED`                                                                                                                                                          | DTO validation (`errors[]` with `field`, one entry per failed constraint), `null` for a required member, `page` > 1 000 000, unknown referenced ids (`typeId`, `engines.0.engineId`, `portIds.1`), engine role/kind mismatch, unsafe formula, `referenceIds` outside the catalog, a malformed `mmsi` list, `sort` or `order`, malformed `:id` / `:mmsi` (not exactly nine digits) / registry key |
| 401    | `UNAUTHORIZED`                                                                                                                                                               | missing or invalid access token                                                                                                                                                                                                                                                                                                                                                                  |
| 403    | `FORBIDDEN`                                                                                                                                                                  | missing permission, or the vessel/organization belongs to another tenant                                                                                                                                                                                                                                                                                                                         |
| 403    | `ORGANIZATION_REQUIRED`                                                                                                                                                      | creating a vessel without an active organization                                                                                                                                                                                                                                                                                                                                                 |
| 403    | `PLATFORM_ADMIN_REQUIRED`                                                                                                                                                    | `orgId`/`legacyId` on writes; every non-admin and API key on `POST /vessels/:id/republish` (`@RequirePlatformAdmin()`)                                                                                                                                                                                                                                                                           |
| 404    | `VESSEL_NOT_FOUND`, `VESSEL_TYPE_NOT_FOUND`, `FUEL_NOT_FOUND`, `ENGINE_NOT_FOUND`, `FUEL_FORMULA_NOT_FOUND`, `PORT_NOT_FOUND`, `REGISTRY_ENTRY_NOT_FOUND`, `PHOTO_NOT_FOUND` |                                                                                                                                                                                                                                                                                                                                                                                                  |
| 409    | `MMSI_ALREADY_EXISTS`, `IMO_ALREADY_EXISTS`, `LEGACY_ID_ALREADY_EXISTS`, `CODE_ALREADY_EXISTS`, `REFERENCE_IN_USE`                                                           |                                                                                                                                                                                                                                                                                                                                                                                                  |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                                                                          | photo over 5 MB                                                                                                                                                                                                                                                                                                                                                                                  |
| 415    | `UNSUPPORTED_MEDIA_TYPE`                                                                                                                                                     | not multipart, or the file is not JPEG/PNG/WebP                                                                                                                                                                                                                                                                                                                                                  |
| 503    | `SERVICE_UNAVAILABLE`                                                                                                                                                        | object storage unreachable during an upload                                                                                                                                                                                                                                                                                                                                                      |

## Events

| Direction                            | Subject                      | Type                       | Payload               | Notes                                                                                                   |
| ------------------------------------ | ---------------------------- | -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| publishes (stream `FLEET`, producer) | `fleet.vessel.v1.<vesselId>` | `fleet.vessel.upserted.v1` | `VesselSnapshotV1`    | after every vessel change and reference cascade; `max_msgs_per_subject = 1` keeps the latest per vessel |
| publishes (stream `FLEET`)           | `fleet.vessel.v1.<vesselId>` | `fleet.vessel.deleted.v1`  | `{ id, mmsi, orgId }` | tombstone                                                                                               |
| publishes (stream `AUDIT`)           | `audit.v1.fleet`             | `audit.recorded.v1`        | `AuditRecordedV1`     | every write, consumed by `auth-audit`                                                                   |
| consumes                             | —                            | —                          | —                     | the service has no consumers                                                                            |

Downstream durable consumers of `FLEET`: `emission-fleet`, `safety-fleet`, `surveillance-fleet`,
`notification-fleet`, `telemetry-fleet`, `ais-processor-fleet`.

Snapshot rules ([`src/domain/vessel-snapshot.ts`](src/domain/vessel-snapshot.ts)):

- envelope `id` = `Nats-Msg-Id` = outbox row id (JetStream deduplicates a relay retry after a crash
  between publish and commit); `subject` = vessel id; `source` = `fleet`;
- `updatedAt` = `vessels.updated_at`, strictly increasing per vessel (every write and every
  cascade advances it with `clock_timestamp()`), so consumers keep the newest snapshot; a
  republish re-sends the same data with the same `updatedAt`;
- `mainEngine` = the main-engine row with its `quantity`; `auxEngines` = **one entry per physical
  auxiliary engine** and `auxEngineQuantity` their number (legacy `engineSpecs` shape:
  `engine: [D2866LE, D2866LE], quantity: 2`);
- `type.capacityFixed` = the regulation-fixed capacity (`null` when the vessel's own capacity applies).

Relay: the kit's `OutboxRelay` (`OutboxModule.forRootAsync`, options from the `OUTBOX_*`
variables in [`src/modules/snapshots/outbox-options.ts`](src/modules/snapshots/outbox-options.ts))
in **per-key** mode — `fleet.outbox` has `seq` and `next_attempt_at`, and the mode is explicit, so
a table without them fails the start instead of falling back to the serial relay. Every replica
relays: a pass claims up to `OUTBOX_BATCH_SIZE` due rows with `FOR UPDATE SKIP LOCKED` in `seq`
order, publishes up to 64 vessels at once — the rows of one vessel one after the other, starting at
its oldest pending row — and marks them in one `UPDATE`. A failed row gets `attempts + 1`, a
sanitized `last_error` and a `next_attempt_at` with equal-jitter exponential backoff (1 s · 2^(n−1),
capped at `OUTBOX_MAX_BACKOFF_MS`; a cap below 1 s bounds every delay); **only its vessel waits**,
the others keep flowing. A row that can never be published (payload no longer valid, subject
mismatch, above the server's `max_payload`) is parked (`failed_at`) and its vessel continues.
Commits wake the relay at once; otherwise it polls every `OUTBOX_POLL_INTERVAL_MS`. Two replicas
sharing a backlog of several rows per vessel are tested to deliver every vessel's snapshots in
`seq` order without gaps or duplicates (observed on core NATS, which sees every publication; the
stream keeps only the latest per vessel), also while vessel writes race a reference cascade; a
failing row is tested to hold back only its own key. The pass keeps its transaction (row locks on
the claimed outbox rows only) open while it publishes: writers are never blocked, other replicas
skip the rows, and the wait is bounded by the JetStream request timeout (10 s) — see
[known limitations](#known-limitations).

## Configuration

Validated with zod at boot ([`src/config.ts`](src/config.ts)); the service refuses to start on
invalid values and prints every problem. [`.env.example`](.env.example) lists every variable (a unit
test keeps it complete).

| Variable                                              | Default                                                | Notes                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `NODE_ENV`                                            | `development`                                          | `development` \| `test` \| `production`                                    |
| `SERVICE_NAME` / `SERVICE_VERSION`                    | `fleet` / package.json version                         | logs, metrics, event `source`, audit subject                               |
| `HOST` / `PORT`                                       | `0.0.0.0` / `3002`                                     |                                                                            |
| `LOG_LEVEL` / `LOG_PRETTY`                            | `info` / `true` in dev                                 | pino                                                                       |
| `SHUTDOWN_TIMEOUT_MS`                                 | `30000`                                                | graceful shutdown deadline                                                 |
| `DATABASE_URL`                                        | `postgres://fleet_svc:fleet_svc@localhost:5432/aisits` |                                                                            |
| `DATABASE_SCHEMA`                                     | `fleet`                                                | `search_path=fleet,public`                                                 |
| `DATABASE_POOL_MAX` / `DATABASE_STATEMENT_TIMEOUT_MS` | `10` / `30000`                                         |                                                                            |
| `DB_MIGRATE_ON_BOOT`                                  | `true`                                                 | also `pnpm migrate`                                                        |
| `NATS_URL`                                            | `nats://localhost:4222`                                | comma separated list allowed                                               |
| `NATS_DURABLE_PREFIX`                                 | empty                                                  | the service has no durable consumers                                       |
| `REDIS_URL`                                           | `redis://localhost:6379`                               | common schema only (Valkey is not used)                                    |
| `AUTH_JWKS_URL`                                       | `http://localhost:3001/.well-known/jwks.json`          | access tokens verified locally                                             |
| `AUTH_ISSUER` / `AUTH_AUDIENCE`                       | `ais-its-auth` / `ais-its-api`                         |                                                                            |
| `AUTH_INTERNAL_URL`                                   | `http://localhost:3001`                                | API-key introspection (no API-key routes here)                             |
| `INTERNAL_TOKEN`                                      | `dev-internal-token-change-me`                         | refused in production                                                      |
| `CORS_ORIGINS`                                        | `http://localhost:5173,http://localhost:8000`          |                                                                            |
| `PUBLIC_BASE_URL`                                     | `http://localhost:8000`                                |                                                                            |
| `TRUSTED_PROXIES`                                     | `loopback,linklocal,uniquelocal`                       | production: the gateway's address or CIDR only (warning at boot otherwise) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                         | unset                                                  | OTLP/HTTP traces (no metrics) when set; `OTEL_TRACES_SAMPLER*` honoured    |
| `S3_ENDPOINT`                                         | `http://localhost:9000`                                | S3 API used by the service                                                 |
| `S3_REGION`                                           | `us-east-1`                                            |                                                                            |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY`                     | `aisits-dev` / `aisits-dev-secret`                     | compose RustFS credentials; refused in production                          |
| `S3_BUCKET_PHOTOS`                                    | `vessel-photos`                                        | created at startup when missing                                            |
| `S3_FORCE_PATH_STYLE`                                 | `true`                                                 | required by RustFS/MinIO                                                   |
| `S3_PUBLIC_ENDPOINT`                                  | = `S3_ENDPOINT`                                        | host of the presigned URLs browsers fetch (gateway/CDN in front of S3)     |
| `FLEET_REPUBLISH_ON_BOOT`                             | `false`                                                | re-enqueue every vessel snapshot at startup                                |
| `OUTBOX_POLL_INTERVAL_MS`                             | `500`                                                  | idle polling interval of the kit's relay (commits wake it at once)         |
| `OUTBOX_BATCH_SIZE`                                   | `100`                                                  | due rows claimed per relay pass                                            |
| `OUTBOX_MAX_BACKOFF_MS`                               | `60000`                                                | cap of the per-row retry backoff (from 1 s, equal jitter)                  |
| `OUTBOX_RETENTION_HOURS`                              | `24`                                                   | published rows kept in `fleet.outbox`                                      |

## Local development

Requirements: Node.js 24 (≥ 22.12), pnpm 10.28.0 (`corepack enable`), Docker. The `@darmawanweb`
packages come from GitHub Packages: map the scope with a token in `~/.npmrc` (never in the repo's
`.npmrc`); inside the central repository the pnpm workspace links them.

```bash
pnpm install
cp .env.example .env
pnpm infra:up              # in the central repo: postgres, nats, s3 (RustFS), …
pnpm dev                   # watch mode on :3002 (migrations on boot)
pnpm build && pnpm seed    # IMO ship types, fuels, case-study engines/formula/ports (idempotent)
pnpm registry:import ./secondaryships.json   # legacy SecondaryShip mongoexport (JSON or NDJSON)
```

Other scripts: `pnpm migrate` (apply migrations without starting), `pnpm openapi` (regenerate
`openapi.json` without infrastructure), `pnpm openapi:check` (CI drift check), `pnpm lint`,
`pnpm typecheck`, `pnpm format`.

```bash
# Example: a vessel of the active organization (token from the auth service)
curl -s -X POST localhost:3002/api/v2/vessels -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d @vessel.json
curl -s -X POST localhost:3002/api/v2/vessels/$ID/photo -H "authorization: Bearer $TOKEN" \
  -F file=@ship.jpg
```

Docker image (BuildKit secrets only; `ca` is optional, for TLS-intercepting proxies):

```bash
DOCKER_BUILDKIT=1 docker build --secret id=npmrc,src=$HOME/.npmrc -t ais-its-fleet-service .
```

## Testing

- `pnpm test` — unit tests next to the code (`src/**/*.spec.ts`): snapshot mapping, the shared
  formula grammar as a regression (incl. the corpus of emission's former verdicts and power-chain
  depth) and the problem codes of `POST /fuel-formulas/validate`, tenancy view selection and DTO
  mapping, `null` handling of every PATCH/create DTO, page bounds, the `mmsi` list, sort keys and
  `referenceIds` validation, the technical sort scope, the NOT NULL safeguard, the deadlock re-run
  of `inTransaction` through the kit, the outbox relay options, engine assignment rules, photo magic
  bytes, registry key/search planning and legacy mapping, seeds (values, sources, catalog reference
  ids, formulas in the grammar), configuration and `.env.example`, methodology catalog ids.
- `pnpm test:int` — integration tests (`test/*.int.test.ts`) against real TimescaleDB/PostGIS, NATS
  and RustFS containers (kit `startTestInfra`, signed test JWTs from `createTestJwtIssuer`):
  vessel CRUD and validation errors (`null` in every PATCH, malformed `:id` / `:mmsi` with the
  field, page bounds), tenancy isolation (two organizations; org admin, fleet manager, viewer,
  authority, super admin), the batch MMSI lookup and server-side sorting (technical keys masked for
  foreign vessels, stable pages), snapshot publication consumed from NATS (Nats-Msg-Id, commit
  order, cascades on fuel/type/engine/formula changes, tombstones, republish refused with
  `403 PLATFORM_ADMIN_REQUIRED` for non-admins, per-key retries with backoff — a failing row holds
  back only its own key —, parked rows, the kit's outbox gauges, boot republish, two relays sharing
  a backlog, vessel writes racing a cascade, a cascade over 70 000 vessels in a rolled-back
  transaction), the engine kind-change race (deterministic, with a share-locked fit in flight),
  seed idempotency, restoration and reference-id linking without republishing, photo
  upload/download/replace/delete against S3, registry import, ranking, match modes and query plans,
  reference data and ports with GeoJSON, usage counts for platform administrators only,
  `referenceIds` without republishing, `POST /fuel-formulas/validate`, the OpenAPI document (uuid
  and mmsi parameter schemas, page maximum, `x-required-roles`), migrations found from another
  working directory, and the schema mirror. Docker is required; set
  `TESTCONTAINERS_RYUK_DISABLED=true` where Ryuk is not available (the global setup stops every
  container).

## Operations

- **Health**: `GET /health/live` (process up), `GET /health/ready` (database and NATS). Object
  storage is not a readiness dependency: the bucket check retries in the background and uploads
  answer `503 SERVICE_UNAVAILABLE` while S3 is down.
- **Metrics** (`GET /metrics`, prefix `aisits_`): HTTP RED metrics and event metrics of the kit
  (`aisits_events_published_total{type,outcome}`), plus
  - `aisits_outbox_relayed_total{type,outcome}` — `published`, `failed` (retried later),
    `rejected` (parked);
  - `aisits_outbox_pending`, `aisits_outbox_oldest_pending_seconds`,
    `aisits_outbox_retrying_rows` (pending rows that failed at least once),
    `aisits_outbox_failed_rows` (parked rows) — the kit's relay refreshes them at most every second
    (parked rows every 10 s);
  - `aisits_fleet_snapshots_enqueued_total{reason}` — `vessel_change`, `vessel_delete`,
    `reference_change`, `republish`;
  - `aisits_fleet_photo_operations_total{operation,outcome}`.
- **Logs**: pino JSON with `requestId`, `traceId` and the principal id; database errors are
  logged without their bound values (the kit sanitizes them; the CLIs log `sanitizeError(e)`). At
  start the relay logs `Relaying outbox table "outbox" in per-key mode`; it logs failed
  publications (`Publishing N outbox row(s) failed, their entity keys wait for a retry`, `warn`)
  and every parked row (`error`); a transaction re-run after a deadlock logs
  `Transaction failed with a deadlock or serialization failure, re-running it` (`warn`); a NOT NULL
  violation answered as `400` logs `NOT NULL violation on column …` (`warn`: a DTO lets `null`
  through and needs a fix). The kit warns at boot when the NATS server's `max_payload` is below
  4 MiB and, in production, while `TRUSTED_PROXIES` is the default.
- **Troubleshooting**
  - _Consumers see stale vessel data_: check `aisits_outbox_pending` / `…oldest_pending_seconds`
    and `SELECT id, attempts, last_error, next_attempt_at FROM fleet.outbox WHERE published_at IS NULL`;
    rows retry automatically once NATS is reachable.
  - _`aisits_outbox_retrying_rows` > 0_: publications fail (NATS unreachable, stream missing);
    only the vessels of those rows wait, each row retries with its own backoff
    (`next_attempt_at`).
  - _`aisits_outbox_failed_rows` > 0_: a stored payload can never be published (`last_error`,
    `failed_at`); fix the data, then `POST /api/v2/vessels/:id/republish` (parked rows never block
    other rows).
  - _The service does not start with `OutboxConfigError`_: `fleet.outbox` lacks `seq` /
    `next_attempt_at` (migrations not applied); run `pnpm migrate`.
  - _FLEET stream lost or purged_: restart one replica with `FLEET_REPUBLISH_ON_BOOT=true` (or call
    republish per vessel); consumers keep the newest snapshot by `updatedAt`.
  - _Photo URLs do not load in the browser_: `S3_PUBLIC_ENDPOINT` must be the host browsers reach
    (signatures are bound to it); the bucket stays private.
  - _`409 REFERENCE_IN_USE` on delete_: reassign the vessels first (`PATCH /vessels/:id`); the same
    code on an engine `kind` change means vessels fit the engine in its current role.
  - _Slow registry searches_: only text queries with `match=contains`, or `auto` queries whose prefix
    matches do not fill a page, scan `registry_particulars`; check the plan with
    `EXPLAIN` of `registrySearchSql` and keep the table `ANALYZE`d after large imports.

- **Upgrading from 0.1.x** (rolling update supported): migrations `0002` (index renames and the
  parked-rows index) and `0003` (`reference_ids` with a constant default) are short catalogue
  changes. During the rollout 0.1 replicas (own relay) and 0.2 replicas (the kit's relay) relay
  together safely: both claim with `FOR UPDATE SKIP LOCKED` and never publish a vessel's row while
  an older one of the vessel is pending, so its snapshots stay in order. Until every replica runs
  0.2, a request may still reach a 0.1 replica, which answers `400 VALIDATION_FAILED` to the new
  query and body members (`mmsi`, `sort`, `order`, `referenceIds`) and `404` to
  `POST /fuel-formulas/validate`, and omits `vesselCount` and `referenceIds`. Dashboards and alerts
  move from `aisits_outbox_failed` / `outcome="retried"` to `aisits_outbox_failed_rows` /
  `outcome="failed"`.

## Seeds and data provenance

`pnpm seed` ([`src/seeds`](src/seeds)) upserts by `code` in one transaction; unchanged rows are not
touched, changed rows republish the vessels that embed them. Every row carries `source`; ship
types, fuels and engines also the catalog `referenceIds` (ship types `imo-mepc-353-78`,
`imo-mepc-354-78`; fuels `imo-mepc-364-79`; the case-study engines `legacy-mvp-backend`, the thesis
is not catalogued yet). Reference ids that differ from the seed are restored by a separate
statement that republishes nothing (`referencesLinked` in the report): no snapshot embeds them.

- **Ship types** — MEPC.353(78) Table 1 (`a`, `c`, fixed capacities 279 000 DWT bulk carriers,
  65 000 DWT LNG carriers < 65 000 DWT, 57 700 GT vehicle carriers) and MEPC.354(78) Table 1
  (`d1..d4` = exp(d_i)), verified 2026-11-21 against IMO text extracts cross-checked with the ClassNK
  CII guide — re-verify against the official text before regulatory use. `lng_carrier_below_65k`
  keeps `a = 14779E10` as printed (the 65 000–100 000 band prints 14479E10). `high_speed_craft`
  borrows the ro-ro passenger rating vector (G4 has no separate row: an assumption). New installs
  get the 2022 ro-ro passenger values (a 2023, c 0.460); the legacy database used the 2021 values
  (a 7540, c 0.587, MEPC.337(76)/MEPC.339(76)) and imported legacy types keep theirs.
  `icon` maps the legacy web icons (`bulkca`, `combin`, `contai`, `cruise`, `gascar`, `genera`,
  `lngcar`, `refrig`, `ro-roc`, `ro-rop`, `ro-rov`, `tanker`, `unknown`).
- **Fuels** — Cf and carbon content of MEPC.364(79): diesel/gas oil 3.206 (0.8744), LFO 3.151
  (0.8594), HFO 3.114 (0.8493), LPG propane 3.000 (0.8182), LPG butane 3.030 (0.8264), ethane 2.927
  (0.7989), LNG 2.750 (0.75), methanol 1.375 (0.375), ethanol 1.913 (0.5217). Densities (t/m³) are
  typical values, documented per row (diesel/gas oil 0.86 = legacy sample; LFO 0.94; HFO 0.98;
  propane 0.51; butane 0.58; ethane 0.55; LNG 0.45; methanol 0.796; ethanol 0.794) — ISO 8217 only
  sets maxima; each row carries a TODO to verify against the bunker delivery note.
- **Case-study samples** (legacy Postman `3.5`–`3.7`, `4`; _SOURCE: thesis — needs citation_):
  main engine NIIGATA 6M28BET (390 rpm, 2100 kW — unit kW or PS unconfirmed, SFOC 179.2 g/kWh),
  auxiliary MAN D2866LE (1800 rpm, 276 kW, 207 g/kWh), first fuel formula of Dharma Ferry VIII,
  ports Padang Bai and Lembar.

## Legacy parity

Legacy sources: `be-legacy/src/models/ships/*`, `src/models/Port.ts`, `src/models/SecondaryShip.ts`,
`src/services/ships`, `src/controllers/ships`, Postman collections `3.*` and `4`.

| Legacy                                                                                                       | v2                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ship.mmsi` (string, unique)                                                                                 | `vessels.mmsi` integer, unique, 9 digits                                                                                                                                                 |
| `ShipGeneral.name`, `imoNumber`, `flag`, `built`, `shipStatus`, `annualVoyagePercentage`, `photoUrl`         | `name`, `imo` (7 digits), `flag` (ISO alpha-2), `built_year`, `status` (`active`\|`inactive`\|`laid_up`), `annual_voyage_percentage`, `photo_key` (S3 object; URL presigned per request) |
| `ShipSize.*` (`bulbosbow`, …)                                                                                | `vessel_dimensions` (`bulbous_bow`, …), see [field meanings](#dimensions-and-hull-coefficients); `gt` added                                                                              |
| `ShipType { name, a, c, capacityUnit, d: { d1..d4 } }`                                                       | `vessel_types` + `code`, `capacity_fixed`, `icon`, `source`                                                                                                                              |
| `Fuel { fuelType, carbonContent, conversionFactor, fuelDensity }`                                            | `fuels { code, name, carbon_content, conversion_factor, density, source }`                                                                                                               |
| `MainEngine { engineName, power, rpm, specificFuelOilConsumption }` / `AuxiliaryEngine { generatorType, … }` | `engines { kind, name, power_kw, rpm, sfoc }`                                                                                                                                            |
| `Ship.engineSpecs.mainEngine { engine, quantity }`, `auxiliaryEngine { engine[], quantity }`                 | `vessel_engines (engine_id, role, quantity)`; snapshot `mainEngine.quantity`, `auxEngines[]` (one per engine) + `auxEngineQuantity`                                                      |
| `FirstFuelFormula { mainEngineFormula, auxiliaryEngineFormula }` evaluated with `new Function`               | `fuel_formulas`, validated against the safe grammar on write; `^` is power (spec §15.4)                                                                                                  |
| `Ship.shipPort[]`, `Port { name, code, administrativeLocation, location { latitude, longitude } }`           | `vessel_ports` (ordered), `ports.geom geography(Point)`; GeoJSON `[lon, lat]` on the wire                                                                                                |
| `SecondaryShip` (upper-case string fields)                                                                   | `registry_particulars` (numbers parsed, `IMO` prefix stripped, document kept in `raw`); `loa`/`beam`/`draught` exposed as `loaM`/`beamM`/`draughtM`                                      |

Intentional differences: authentication and tenancy everywhere (spec §8); technical data private to
the owning organization; ship types gain `capacity_fixed`; reference rows in use cannot be deleted
(the legacy left dangling references); snapshots are published as events instead of being joined
on read.

## Known limitations

- **Relay transaction during publication** — a pass of the kit's relay holds its transaction
  (locks on the claimed outbox rows only) while it publishes; during a NATS outage one pooled
  connection stays idle in transaction for up to the 10 s JetStream request timeout per pass. The
  lock is what keeps a vessel's snapshots in order across replicas without a lease protocol.
- **Reference ids follow the shipped catalog** — `referenceIds` are validated against the
  methodology catalog of the installed contracts (0.4.0: 149 references); an id catalogued later is
  refused until the service is upgraded.
- **Not served here** — last-seen positions and CII grades of the vessel list (`include=lastSeen,
ciiGrade` was proposed): fleet keeps master data and owns neither, and spec §6 forbids reading
  other schemas; the web app combines the ais-pipeline positions and the emission fleet summary
  (which sorts and searches itself). The vessel `type.code` the emission summary lacks is in every
  `VesselSnapshotV1` already.
- **Retries are not counted** — the deadlock re-runs of `inTransaction` are logged, not exported as
  a metric.
- **Orphaned photo objects** — the S3 object of a replaced or deleted photo is removed after the
  commit; when that delete fails the object stays (logged, `aisits_fleet_photo_operations_total`
  `outcome="failed"`). Objects are private and unreferenced; a sweeper or bucket lifecycle rule is a
  follow-up.
- **Photos in memory** — an upload (≤ 5 MB, enforced by the multipart limit) is buffered before the
  magic-byte check and the `PutObject` with a known length.
- **Boot republish on several replicas** — each replica started with `FLEET_REPUBLISH_ON_BOOT=true`
  enqueues every snapshot again; harmless (identical data, consumers keep the newest `updatedAt`).
- **Image size** — the runtime image (480 MB, of which 200 MB `node_modules`) carries the production
  dependencies (AWS SDK, OpenTelemetry trace SDK, NestJS); since kit 0.3 it holds no test or gRPC
  packages (`testcontainers`, `dockerode`, `ssh2`, `@nestjs/testing`, `pino-pretty`,
  `@grpc/grpc-js`, `protobufjs`, `@opentelemetry/sdk-node`), and it is not trimmed further.
- **No `seed:demo`** — the case-study reference rows are seeded; the Dharma Ferry VIII vessel is
  created through the API for an organization.
- **Seed values** — ship-type and fuel values come from verified IMO text extracts and must be
  re-verified against the official resolutions before regulatory use (each row's `source` says so).

## Methodology & references

This service implements no computation of its own beyond checking formulas against the shared
grammar; it is the system of record for the parameters other services compute with, and ship
types, fuels and engines link their values to the catalog's references (`referenceIds`). Method ids (catalog
[`docs/references/methods.json`](../../docs/references/methods.json), served at
`GET /api/v2/fleet/methodology`) and where they live here:

| Method                                                                                   | In this service                                                                                                                                                                       | Sources                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`fuel.first_formula`](../../docs/METHODOLOGY.md#fuel.first_formula)                     | `src/modules/common/validation.ts#IsFuelFormula` (contracts `validateFuelFormula` on write), `src/domain/fuel-formula-problem.ts#fuelFormulaProblem` (`POST /fuel-formulas/validate`) | legacy MVP `utils/cii/fuel-calculation.ts`; [spec §13.5, §15.4](../../docs/PLATFORM_SPEC.md)                                        |
| [`cii.reference_line`](../../docs/METHODOLOGY.md#cii.reference_line)                     | `src/seeds/vessel-types.seed.ts` (`a`, `c`, `capacityFixed`)                                                                                                                          | [IMO MEPC.353(78)](<https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.353(78).pdf>) |
| [`cii.rating_grade`](../../docs/METHODOLOGY.md#cii.rating_grade)                         | `src/seeds/vessel-types.seed.ts` (`d1..d4`)                                                                                                                                           | [IMO MEPC.354(78)](<https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.354(78).pdf>) |
| [`emission.co2_conversion`](../../docs/METHODOLOGY.md#emission.co2_conversion)           | `src/seeds/fuels.seed.ts` (Cf, carbon content)                                                                                                                                        | [IMO MEPC.364(79)](<https://wwwcdn.imo.org/localresources/en/KnowledgeCentre/IndexofIMOResolutions/MEPCDocuments/MEPC.364(79).pdf>) |
| [`fuel.density_conversion`](../../docs/METHODOLOGY.md#fuel.density_conversion)           | `src/seeds/fuels.seed.ts` (densities)                                                                                                                                                 | [ISO 8217:2024](https://www.iso.org/standard/80579.html); legacy sample (needs citation)                                            |
| [`fuel.me_regression_sample`](../../docs/METHODOLOGY.md#fuel.me_regression_sample)       | `src/seeds/samples.seed.ts` (`dharma_ferry_viii` main-engine formula)                                                                                                                 | thesis case study — needs citation                                                                                                  |
| [`fuel.ae_regression`](../../docs/METHODOLOGY.md#fuel.ae_regression)                     | `src/seeds/samples.seed.ts` (auxiliary-engine formula)                                                                                                                                | thesis case study — needs citation                                                                                                  |
| [`data.sample_vessel_reference`](../../docs/METHODOLOGY.md#data.sample_vessel_reference) | `src/seeds/samples.seed.ts` (engines, ports), `test/fixtures/sample-vessel.ts`                                                                                                        | legacy Postman `3.*`, `4` — needs citation                                                                                          |

The CII reduction factors Z (MEPC.338(76), MEPC.400(83)) are owned and seeded by the emission
service. Hull-form fields are documented for the Holtrop–Mennen chain of the emission service
([Holtrop & Mennen 1982](https://www.marin.nl/en/publications/an-approximate-power-prediction-method),
[METHODOLOGY §7.3](../../docs/METHODOLOGY.md)).

## Contributing

Conventional commits (commitlint + Husky). Migrations are forward-only: add
`migrations/NNNN_<change>.sql` and mirror it in `src/db/schema.ts` (the schema mirror test fails
otherwise). Regenerate `openapi.json` with
`pnpm openapi` when routes or DTOs change. See [CHANGELOG.md](CHANGELOG.md).
