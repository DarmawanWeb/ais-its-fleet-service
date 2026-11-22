# Changelog

All notable changes to `ais-its-fleet-service` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the service adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/DarmawanWeb/ais-its-fleet-service/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DarmawanWeb/ais-its-fleet-service/releases/tag/v0.1.0
