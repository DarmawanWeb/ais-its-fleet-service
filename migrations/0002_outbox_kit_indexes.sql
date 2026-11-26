-- ---------------------------------------------------------------------------
-- fleet.outbox for the kit's per-key relay (@darmawanweb/ais-its-nest 0.3,
-- OutboxModule), which replaces the service's own relay.
--
-- 0001 already created everything the per-key mode needs: seq (identity,
-- insertion order) and next_attempt_at (NOT NULL DEFAULT now(), i.e. due when
-- written; the kit treats NULL and past times alike). This migration only
-- aligns the indexes with the kit's DDL (outboxTableSql / outboxUpgradeSql):
--
-- * the two pending indexes of 0001 get the kit's names, so the kit's
--   IF NOT EXISTS DDL finds them instead of creating copies;
-- * the kit's index of parked rows is added (the aisits_outbox_failed_rows
--   gauge counts them).
--
-- Deliberately not created: the kit's outbox_retry_idx (entity_key, seq WHERE
-- next_attempt_at IS NOT NULL), which would equal outbox_pending_key_idx here
-- because next_attempt_at is NOT NULL, and the kit's outbox_pending_idx
-- (created_at, id) of the serial mode, which a table with seq never uses.
-- Renaming an index and indexing the (small) parked set are catalogue changes
-- and short builds; 0.1 relays keep working during a rolling upgrade.
-- ---------------------------------------------------------------------------

ALTER INDEX IF EXISTS outbox_pending_idx RENAME TO outbox_pending_seq_idx;
ALTER INDEX IF EXISTS outbox_entity_pending_idx RENAME TO outbox_pending_key_idx;

CREATE INDEX IF NOT EXISTS outbox_failed_idx ON outbox (failed_at)
  WHERE failed_at IS NOT NULL;
