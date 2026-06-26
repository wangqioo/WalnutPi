ALTER TABLE retrieval_documents
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'curated_corpus';

ALTER TABLE retrieval_documents
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'curated';

CREATE INDEX IF NOT EXISTS retrieval_documents_source_kind_status_idx
  ON retrieval_documents (source_kind, status);

CREATE INDEX IF NOT EXISTS retrieval_documents_status_idx
  ON retrieval_documents (status);
