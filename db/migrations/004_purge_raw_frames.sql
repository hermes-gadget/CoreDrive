-- Purge packet payload bytes captured before the metadata-only policy.
UPDATE observations SET raw_frame = NULL WHERE raw_frame IS NOT NULL;

UPDATE ingest_outbox
   SET payload = payload #- '{obs,rawFrame}'
 WHERE payload #> '{obs,rawFrame}' IS NOT NULL;
