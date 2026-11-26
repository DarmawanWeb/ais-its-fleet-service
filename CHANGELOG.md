# Changelog

All notable changes to `ais-its-fleet-service` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the service adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-23

Upgrade to `@darmawanweb/ais-its-contracts` 0.4.0 and `@darmawanweb/ais-its-nest` 0.3.0: the
local workarounds of 0.1 are replaced by the kit APIs the service asked for, and the backend gaps
the web app reported are closed. Rolling updates from 0.1.x are supported (see _Upgrading_).

### Added

- `GET /vessels?mmsi=a,b,c` — batch identity lookup of 1–100 MMSIs (comma-separated or a repeated
  parameter; unknown ones absent), each vessel in the view the principal may see, so lists name all
  their vessels in one request.
- `GET /vessels?sort=name|mmsi|imo|gt|dwt|builtYear|updatedAt&order=asc|desc` — server-side
  sorting with stable pages (ties by name, then id; missing values last). `gt`, `dwt` and
  `builtYear` are technical data (spec §8.5): their values order only the vessels whose detail view
  the principal receives, foreign vessels follow by name, so a sort reveals nothing about them.
- `vesselCount` on vessel types, fuels, engines, fuel formulas and ports (list rows and
  `GET /:id`) for principals with `reference:write`: the vessels of every organization that use the
  row, so clients can disable delete before `409 REFERENCE_IN_USE`. Other principals get the rows
  without it (the count spans every tenant's technical data).
- `POST /fuel-formulas/validate { formula }` (`vessel:read`) → `200 { valid, problem }` with a
  stable `code` (`UNKNOWN_IDENTIFIER`, `WRONG_ARGUMENT_COUNT`, `NESTED_TOO_DEEPLY`, …), `message`,
  `position` and `token` of the first problem; nothing is stored. The formula is checked as
  `POST` / `PATCH` store it (trimmed, so whitespace around a formula of at most 500 characters is
  no `FORMULA_TOO_LONG`), with positions in the text as sent.
- `referenceIds` on vessel types, fuels and engines (migration `0003_reference_ids.sql`,
  `text[]`, ≤ 20): ids of the methodology catalog's references next to the free-text `source`,
  validated against contracts `REFERENCES` (`400 VALIDATION_FAILED` otherwise; `[]` clears, `null`
  is refused). The seeds cite `imo-mepc-353-78` / `imo-mepc-354-78` (ship types),
  `imo-mepc-364-79` (fuels) and `legacy-mvp-backend` (case-study engines); `pnpm seed` restores
  them without republishing (`referencesLinked` in the report).
- Migration `0002_outbox_kit_indexes.sql`: the pending outbox indexes get the names of the kit's
  outbox DDL (`outbox_pending_seq_idx`, `outbox_pending_key_idx`) and the kit's
  `outbox_failed_idx` is added.
- Metrics of the kit's relay: `aisits_outbox_retrying_rows`, `aisits_outbox_failed_rows`.
- The migrations directory is resolved from the package (`MIGRATIONS_DIR` in `src/service.ts`,
  used by the app and `pnpm migrate`), so a process started elsewhere still finds it.

### Changed

- **Outbox relay**: the kit's `OutboxRelay` (`OutboxModule.forRootAsync`, explicit `per-key`
  mode) replaces the service's `FleetOutboxRelay`: every replica relays, a vessel's rows go out in
  `seq` order, a failing row backs off on its own (equal-jitter exponential from 1 s up to
  `OUTBOX_MAX_BACKOFF_MS`) and only its vessel waits; parked rows now also cover messages above
  the server's `max_payload`. Same variables, same `fleet.outbox` table and envelope ids. A pass
  still publishes all its vessels at once (`publishConcurrency` = `OUTBOX_BATCH_SIZE` instead of
  the kit's 64), so while NATS does not answer it waits one 10 s JetStream request timeout, not
  one per 64 vessels (which at `OUTBOX_BATCH_SIZE=1000` would outlast `SHUTDOWN_TIMEOUT_MS`).
- **Metric changes** (dashboards and alerts): `aisits_outbox_relayed_total` reports
  `outcome="failed"` instead of `"retried"`; the gauge `aisits_outbox_failed` is now
  `aisits_outbox_failed_rows`; the outbox gauges are refreshed at most every second (parked rows
  every 10 s) instead of after every pass.
- `POST /vessels/:id/republish` is guarded by the kit's `@RequirePlatformAdmin()`: same
  `403 PLATFORM_ADMIN_REQUIRED`, now also documented in OpenAPI (`x-required-roles: ["super_admin"]`)
  and checked before the route's permission. API keys never reach that check (no fleet route
  accepts them): an `X-API-Key` gets `401 INVALID_API_KEY`, which the operation's description
  states next to the kit's generic sentence.
- A reference-data PATCH that changes only members the snapshots do not embed (`source`,
  `referenceIds`, a ship type's `icon`, an engine's `code`, a formula's `name` / `code`)
  republishes no vessel; changes of embedded members still republish every vessel using the row.
- First fuel formulas are validated with the shared grammar of contracts
  (`validateFuelFormula`): limits, messages and positions are those of 0.1 (contracts took over
  the service's parser), so stored formulas keep validating.
- `openapi.json`: `format: uuid` on every `:id`, `pattern: ^[0-9]{9}$` on `:mmsi`, the page
  maximum of 1 000 000, `x-required-roles` on republish, the new parameters and fields.
- Kit 0.3 behaviour: database errors are sanitized in logs and problem details (the seed and
  registry CLIs log `sanitizeError(e)`), tracing exports traces only, CORS exposes `ETag` and
  `Location`, warnings at boot for a NATS `max_payload` below 4 MiB and (production) for the default
  `TRUSTED_PROXIES` (documented in `.env.example`: the gateway's CIDR only).
- Dependencies: `@darmawanweb/ais-its-contracts` ^0.4.0, `@darmawanweb/ais-its-nest` ^0.3.0;
  `prom-client` removed (metric types from `@darmawanweb/ais-its-nest/metrics`); `.pnpmfile.cjs`
  keeps terminus' optional gRPC peers out of the production install (template of kit 0.3).

### Removed

- Local workarounds now covered by the kit or contracts: `src/modules/snapshots/outbox-relay.ts`,
  `outbox.repository.ts`, `retry-backoff.ts` (per-key relay); the retry loop of
  `src/db/database.ts#inTransaction` (`withTransaction({ retries })` follows drizzle's error
  causes); `src/modules/common/params.ts` (`ID_PIPE`, `MmsiParam`, `parseMmsiParam` →
  `@UuidParam()`, `@MmsiParam()`); `BoundedPageQueryDto`, `MAX_PAGE` and `IsOptionalNonNull` of
  `src/modules/common/validation.ts` (→ `PageQueryDto`, `MAX_PAGE`, `@IsOptionalNotNull()`);
  `src/domain/fuel-formula.ts` (→ contracts `validateFuelFormula` / `parseFuelFormula`; its tests
  stay as regression tests); `src/db/errors.ts` (→ `isUniqueViolation`, `sqlStateOf`,
  `databaseErrorInfo`, `PG_SQLSTATES`).

### Upgrading

- Migrations `0002` and `0003` run at boot (short catalogue changes and a constant-default
  column). 0.1 and 0.2 replicas relay together safely during a rolling update (both claim with
  `FOR UPDATE SKIP LOCKED` and never publish a vessel's row while an older one is pending).
- Until every replica runs 0.2, a 0.1 replica answers `400 VALIDATION_FAILED` to the new members
  (`mmsi`, `sort`, `order`, `referenceIds`), `404` to `POST /fuel-formulas/validate` and omits
  `vesselCount` / `referenceIds`: roll out before clients use them.
- Rename `aisits_outbox_failed` → `aisits_outbox_failed_rows` and `outcome="retried"` →
  `outcome="failed"` in dashboards and alerts; set `TRUSTED_PROXIES` to the gateway's CIDR and
  `max_payload: 4MB` on the NATS server.

## [0.1.0] - 2026-11-21

### Added

- Vessel master data (spec §13.3): `vessels`, `vessel_dimensions` (legacy `ShipSize`, `bulbosbow`
  → `bulbousBow`, documented hull coefficients), `vessel_engines` (one main row with quantity,
  ordered auxiliaries), `vessel_ports` (ordered), lookup by id and by MMSI, page-based list with
  search (name substring, IMO/MMSI digit prefixes), `typeCode`, `orgId` and `status` filters.
- Tenancy (spec §8.5): `VesselSummaryDto` (identity) for every principal with `vessel:read`,
  `VesselDetailDto` (technical data) for the owning organization and platform administrators;
  vessels are created in the active organization (`orgId` and `legacyId` reserved to
  `super_admin`); writes require ownership.
- Reference data CRUD (read `vessel:read`, write `reference:write`): vessel types with the CII
  reference line, rating vector and the new `capacity_fixed`, fuels, engines (`?kind=`), first fuel
  formulas, ports with GeoJSON points and `bbox` filter; unique codes (`409 CODE_ALREADY_EXISTS`),
  rows in use cannot be deleted (`409 REFERENCE_IN_USE`).
- Safe first-fuel-formula grammar (`src/domain/fuel-formula.ts`, recursive-descent parser, no
  `eval`): numbers, `speedKnot`, `+ - * / ** ^ ( )` and the functions `exp`, `log`, `ln`, `sqrt`,
  `pow`, `abs`, `min`, `max` (optionally `Math.`-prefixed); anything else is
  `400 VALIDATION_FAILED` with the position.
- Transactional outbox of `VesselSnapshotV1` / `VesselDeletedV1` in `fleet.outbox`, written in the
  transaction of every vessel change and of every reference-data change (all affected vessels);
  relay to `fleet.vessel.v1.<vesselId>` with `Nats-Msg-Id` = outbox id, `FOR UPDATE SKIP LOCKED`
  claims that keep per-vessel order across replicas, exponential backoff with jitter, parking of
  invalid payloads, retention cleanup and metrics (`aisits_outbox_*`,
  `aisits_fleet_snapshots_enqueued_total`). The service is the producer of the `FLEET` stream.
- `POST /vessels/:id/republish` (`super_admin`) and `FLEET_REPUBLISH_ON_BOOT`.
- Vessel photos: multipart upload ≤ 5 MB, JPEG/PNG/WebP recognized by magic bytes, stored in S3
  (bucket ensured after bootstrap), presigned GET URLs (1 h) for `S3_PUBLIC_ENDPOINT`, object
  deleted with the photo or the vessel (`aisits_fleet_photo_operations_total`).
- Registry particulars (legacy `SecondaryShip`): `GET /registry/search?q&match` (name prefix, IMO
  prefix and MMSI range as separate `UNION ALL` index scans, exact matches first; the scanning
  substring arm only for text queries with `match=contains`, or with `match=auto` when the indexed
  arms do not fill a page; no `pg_trgm`), `GET /registry/:imoOrMmsi`, `pnpm registry:import` for
  mongoexport JSON/NDJSON.
- Seeds (`pnpm seed`, idempotent upserts by code, every row with its `source`): ship types of
  MEPC.353(78)/MEPC.354(78) with fixed capacities and legacy icons, fuels with Cf and carbon
  content of MEPC.364(79) and documented typical densities, the case-study engines, first fuel
  formula and ports; changed seed rows republish the vessels that embed them.
- Audit events for every write, `GET /api/v2/fleet/methodology`, problem-details error codes,
  migrations `0001_init.sql`, OpenAPI document, Docker image, CI.
- Tests: unit tests (snapshot mapping, formula grammar and the corpus shared with the emission
  evaluator, tenancy view selection, DTO mapping and `null` handling, page bounds, `:mmsi` parsing,
  engine rules, photo detection, registry parsing, transaction retries, seeds, configuration) and
  integration tests on TimescaleDB/PostGIS, NATS and RustFS containers (including two relays on one
  backlog, writes racing a cascade, the engine kind-change race, registry query plans on 20 000
  rows and the schema mirror).

### Fixed

Found in review before the first release:

- `null` in a PATCH body for a NOT NULL member (or a nested `d`/`location`) answered
  `500 INTERNAL_ERROR`; every PATCH DTO now validates present members, `null` included (`PatchType`),
  optional create members that are not nullable refuse `null`, and a NOT NULL violation that still
  reaches PostgreSQL is answered `400 VALIDATION_FAILED`.
- Registry searches of 3+ characters, exact IMO/MMSI lookups included, scanned the whole table twice
  (an `OR` with the unindexable substring predicate).
- A kind change of an engine could race a vessel write fitting the engine in its old role; the
  engine row is now locked before its vessels are counted.
- A reference-data cascade over more than 65 535 vessels failed (one bind parameter per vessel); the
  vessels are now locked and touched in one statement.
- Deadlocks between vessel writes and cascades were never retried (`500`): the kit's
  `withTransaction` reads the SQLSTATE of the thrown error only, and drizzle wraps it; the retry now
  follows error causes (workaround in `src/db/database.ts`).
- `GET /vessels/by-mmsi/:mmsi` answered `404` or `500` for malformed or out-of-range values; it now
  requires exactly nine digits forming a valid MMSI (`400 VALIDATION_FAILED`).
- A huge `page` overflowed the `OFFSET` (`500`); `page` is now limited to 1 000 000 on every list.
- The formula grammar did not depth-limit chains of powers and accepted formulas the emission
  evaluator refuses; exponents now count as nesting levels as in emission.
- Aggregate loading issued overlapping queries on one transaction client (pg deprecation warning);
  the queries now run one after the other.
- `src/db/schema.ts` did not declare most indexes, the CHECK constraints and the constraint names of
  the migration; it now mirrors them all and an integration test compares both.

[Unreleased]: https://github.com/DarmawanWeb/ais-its-fleet-service/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/DarmawanWeb/ais-its-fleet-service/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DarmawanWeb/ais-its-fleet-service/releases/tag/v0.1.0
