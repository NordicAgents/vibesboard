-- Keep the best row for each legacy duplicate before making the invariant
-- enforceable. Prefer an indexed row, then the most recently updated row.
CREATE TEMP TABLE files_to_dedupe AS
SELECT id
FROM (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY agent_id, file_key
      ORDER BY
        CASE status
          WHEN 'indexed' THEN 0
          WHEN 'processing' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        updated_at DESC,
        id
    ) AS duplicate_rank
  FROM files
) ranked
WHERE duplicate_rank > 1;
--> statement-breakpoint
DELETE FROM embeddings
USING files_to_dedupe
WHERE embeddings.source_type = 'file_chunk'
  AND embeddings.source_id = files_to_dedupe.id;
--> statement-breakpoint
DELETE FROM embeddings_1536
USING files_to_dedupe
WHERE embeddings_1536.source_type = 'file_chunk'
  AND embeddings_1536.source_id = files_to_dedupe.id;
--> statement-breakpoint
DELETE FROM embeddings_384
USING files_to_dedupe
WHERE embeddings_384.source_type = 'file_chunk'
  AND embeddings_384.source_id = files_to_dedupe.id;
--> statement-breakpoint
DELETE FROM embeddings_1024
USING files_to_dedupe
WHERE embeddings_1024.source_type = 'file_chunk'
  AND embeddings_1024.source_id = files_to_dedupe.id;
--> statement-breakpoint
DELETE FROM files
USING files_to_dedupe
WHERE files.id = files_to_dedupe.id;
--> statement-breakpoint
DROP TABLE files_to_dedupe;
--> statement-breakpoint
CREATE UNIQUE INDEX "files_agent_key_uq" ON "files" USING btree ("agent_id","file_key");
