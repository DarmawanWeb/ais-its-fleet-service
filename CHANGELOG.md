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
- Registry particulars (legacy `SecondaryShip`): `GET /registry/search?q` (name prefix/substring,
  IMO and MMSI prefixes over btree indexes, no `pg_trgm`), `GET /registry/:imoOrMmsi`,
  `pnpm registry:import` for mongoexport JSON/NDJSON.
- Seeds (`pnpm seed`, idempotent upserts by code, every row with its `source`): ship types of
  MEPC.353(78)/MEPC.354(78) with fixed capacities and legacy icons, fuels with Cf and carbon
  content of MEPC.364(79) and documented typical densities, the case-study engines, first fuel
  formula and ports; changed seed rows republish the vessels that embed them.
- Audit events for every write, `GET /api/v2/fleet/methodology`, problem-details error codes,
  migrations `0001_init.sql`, OpenAPI document, Docker image, CI.
- Tests: unit tests (snapshot mapping, formula grammar, tenancy view selection, DTO mapping,
  engine rules, photo detection, registry parsing, seeds, configuration) and integration tests on
  TimescaleDB/PostGIS, NATS and RustFS containers.

[Unreleased]: https://github.com/DarmawanWeb/ais-its-fleet-service/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DarmawanWeb/ais-its-fleet-service/releases/tag/v0.1.0
