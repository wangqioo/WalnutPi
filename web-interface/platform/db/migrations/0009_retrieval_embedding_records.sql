CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS retrieval_embedding_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  source text NOT NULL,
  text_hash text NOT NULL,
  embedding_model text NOT NULL,
  embedding vector(384) NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retrieval_embedding_records_allowed_source_kind
    CHECK (source_kind IN ('approved_memory', 'curated_corpus')),
  CONSTRAINT retrieval_embedding_records_allowed_source_table
    CHECK (source_table IN ('durable_memory_records', 'retrieval_documents'))
);

CREATE UNIQUE INDEX IF NOT EXISTS retrieval_embedding_records_source_idx
  ON retrieval_embedding_records (source_kind, source_id);

CREATE INDEX IF NOT EXISTS retrieval_embedding_records_source_kind_idx
  ON retrieval_embedding_records (source_kind);

CREATE INDEX IF NOT EXISTS retrieval_embedding_records_embedding_hnsw_idx
  ON retrieval_embedding_records
  USING hnsw (embedding vector_cosine_ops);
