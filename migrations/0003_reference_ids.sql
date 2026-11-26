-- ---------------------------------------------------------------------------
-- Citable provenance of reference data: ids of the methodology catalog's
-- references (docs/references/references.json, contracts REFERENCES) next to
-- the free-text source of ship types, fuels and engines, so clients can link
-- them to the catalog (DataAttribution, MethodInfo). The service validates
-- the ids against the catalog it ships with; the column only bounds the size.
-- Adding a column with a constant default rewrites nothing; 0.1 replicas
-- neither read nor write it during a rolling upgrade.
-- ---------------------------------------------------------------------------

ALTER TABLE vessel_types
  ADD COLUMN reference_ids text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(reference_ids) <= 20);

ALTER TABLE fuels
  ADD COLUMN reference_ids text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(reference_ids) <= 20);

ALTER TABLE engines
  ADD COLUMN reference_ids text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(reference_ids) <= 20);
