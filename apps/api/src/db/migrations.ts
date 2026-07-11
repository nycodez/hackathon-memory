export const migrations = [
  {
    id: '001_knowledge_workspace',
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS unaccent;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        name text NOT NULL,
        mime_type text NOT NULL,
        size_bytes integer NOT NULL CHECK (size_bytes >= 0),
        content_sha256 text NOT NULL,
        raw_data bytea NOT NULL,
        extracted_text text,
        summary text,
        status text NOT NULL DEFAULT 'ingested' CHECK (
          status IN ('ingested', 'extracting', 'needs_ocr', 'summarizing', 'vectorizing', 'ready', 'failed')
        ),
        requires_ocr boolean NOT NULL DEFAULT false,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, content_sha256)
      );

      CREATE INDEX IF NOT EXISTS knowledge_documents_workspace_status_idx
        ON knowledge_documents (workspace_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS document_chunks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        chunk_index integer NOT NULL,
        content text NOT NULL,
        token_estimate integer NOT NULL,
        embedding vector(1024) NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (document_id, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS document_chunks_workspace_idx
        ON document_chunks (workspace_id, document_id);
      CREATE INDEX IF NOT EXISTS document_chunks_search_idx
        ON document_chunks USING gin (search_vector);
      CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
        ON document_chunks USING hnsw (embedding vector_cosine_ops);

      CREATE TABLE IF NOT EXISTS conversation_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        title text NOT NULL DEFAULT 'New conversation',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS conversation_sessions_workspace_updated_idx
        ON conversation_sessions (workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        conversation_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('user', 'assistant')),
        content text NOT NULL,
        citations jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx
        ON conversation_messages (conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS ingestion_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        stage text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS ingestion_events_document_idx
        ON ingestion_events (document_id, created_at);
    `,
  },
  {
    id: '002_conversation_decision_trace',
    sql: `
      ALTER TABLE conversation_messages
        ADD COLUMN IF NOT EXISTS decision_trace jsonb NOT NULL DEFAULT '[]'::jsonb;
    `,
  },
  {
    id: '003_library_folders',
    sql: `
      CREATE TABLE IF NOT EXISTS library_folders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        parent_id uuid REFERENCES library_folders(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS library_folders_parent_idx
        ON library_folders (workspace_id, parent_id, name);
      CREATE UNIQUE INDEX IF NOT EXISTS library_folders_unique_root_name_idx
        ON library_folders (workspace_id, lower(name))
        WHERE parent_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS library_folders_unique_child_name_idx
        ON library_folders (workspace_id, parent_id, lower(name))
        WHERE parent_id IS NOT NULL;

      ALTER TABLE knowledge_documents
        ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES library_folders(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS knowledge_documents_folder_idx
        ON knowledge_documents (workspace_id, folder_id, updated_at DESC);
    `,
  },
  {
    id: '004_organizational_memory_capabilities',
    sql: `
      CREATE OR REPLACE FUNCTION classification_rank(value text) RETURNS integer
      LANGUAGE sql IMMUTABLE STRICT AS $$
        SELECT CASE value
          WHEN 'public' THEN 0
          WHEN 'internal' THEN 1
          WHEN 'confidential' THEN 2
          WHEN 'restricted' THEN 3
          ELSE 99
        END
      $$;

      CREATE TABLE IF NOT EXISTS capability_teams (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        name text NOT NULL,
        department text NOT NULL,
        UNIQUE (workspace_id, name)
      );

      CREATE TABLE IF NOT EXISTS capability_people (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        name text NOT NULL,
        role text NOT NULL,
        team_id text NOT NULL REFERENCES capability_teams(id),
        status text NOT NULL CHECK (status IN ('active', 'departed')),
        clearance text NOT NULL CHECK (clearance IN ('public', 'internal', 'confidential', 'restricted')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS capability_people_workspace_idx
        ON capability_people (workspace_id, status, team_id);

      CREATE TABLE IF NOT EXISTS capability_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        asset_key text NOT NULL,
        request_id text NOT NULL,
        type text NOT NULL CHECK (type IN ('workflow', 'prompt', 'agent', 'skill', 'decision', 'outcome')),
        title text NOT NULL,
        summary text NOT NULL,
        content text NOT NULL,
        rationale text NOT NULL,
        classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
        owner_team_id text NOT NULL REFERENCES capability_teams(id),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        current_version text NOT NULL DEFAULT 'v1.0',
        outcome_score numeric(5,4) NOT NULL DEFAULT 0 CHECK (outcome_score BETWEEN 0 AND 1),
        usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
        last_used_at timestamptz,
        created_by_person_id text NOT NULL REFERENCES capability_people(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, asset_key),
        UNIQUE (workspace_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS capability_assets_workspace_idx
        ON capability_assets (workspace_id, status, owner_team_id, classification, updated_at DESC);

      CREATE TABLE IF NOT EXISTS capability_asset_documents (
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        relationship text NOT NULL CHECK (relationship IN ('primary_artifact', 'evidence', 'instructions', 'example', 'decision_context')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (capability_id, document_id, relationship)
      );
      CREATE INDEX IF NOT EXISTS capability_asset_documents_document_idx
        ON capability_asset_documents (document_id, capability_id);

      CREATE TABLE IF NOT EXISTS capability_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        version text NOT NULL,
        change_notes text NOT NULL,
        snapshot jsonb NOT NULL,
        created_by_person_id text NOT NULL REFERENCES capability_people(id),
        approved_by_person_id text REFERENCES capability_people(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_id, version)
      );

      CREATE TABLE IF NOT EXISTS capability_edges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        edge_type text NOT NULL CHECK (edge_type IN ('AUTHORED_BY', 'STEWARDED_BY', 'DEPENDS_ON', 'DERIVED_FROM', 'APPROVED_BY', 'PRODUCED_OUTCOME')),
        target_kind text NOT NULL CHECK (target_kind IN ('person', 'capability', 'decision', 'outcome')),
        target_key text NOT NULL,
        target_label text NOT NULL,
        evidence text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_id, edge_type, target_kind, target_key)
      );
      CREATE INDEX IF NOT EXISTS capability_edges_workspace_idx
        ON capability_edges (workspace_id, capability_id, edge_type);

      CREATE TABLE IF NOT EXISTS capability_stewardship_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        from_person_id text NOT NULL REFERENCES capability_people(id),
        to_person_id text NOT NULL REFERENCES capability_people(id),
        reason text NOT NULL,
        assigned_at timestamptz NOT NULL,
        accepted_at timestamptz,
        UNIQUE (capability_id, to_person_id)
      );

      CREATE TABLE IF NOT EXISTS capability_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        decided_by_person_id text NOT NULL REFERENCES capability_people(id),
        decision text NOT NULL,
        rationale text NOT NULL,
        decided_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_outcomes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        metric_name text NOT NULL,
        value numeric NOT NULL,
        unit text NOT NULL,
        measured_at date NOT NULL,
        UNIQUE (capability_id, metric_name, measured_at)
      );

      CREATE TABLE IF NOT EXISTS capability_installations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id) ON DELETE CASCADE,
        actor_person_id text NOT NULL REFERENCES capability_people(id),
        version text NOT NULL,
        installed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_id, actor_person_id, version)
      );

      CREATE TABLE IF NOT EXISTS capability_skill_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES capability_assets(id),
        actor_person_id text NOT NULL REFERENCES capability_people(id),
        version text NOT NULL,
        status text NOT NULL CHECK (status IN ('completed', 'blocked', 'failed')),
        input jsonb NOT NULL,
        output jsonb NOT NULL,
        provenance_path jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS capability_skill_runs_actor_idx
        ON capability_skill_runs (workspace_id, actor_person_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS capability_audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        actor_person_id text REFERENCES capability_people(id),
        capability_id uuid REFERENCES capability_assets(id) ON DELETE SET NULL,
        action text NOT NULL,
        decision text NOT NULL CHECK (decision IN ('allow', 'deny')),
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS capability_audit_events_workspace_idx
        ON capability_audit_events (workspace_id, created_at DESC);
    `,
  },
  {
    id: '005_grounded_capability_execution',
    sql: `
      ALTER TABLE capability_skill_runs
        ADD COLUMN IF NOT EXISTS skill_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS decision_trace jsonb NOT NULL DEFAULT '[]'::jsonb;

      CREATE INDEX IF NOT EXISTS capability_skill_runs_capability_created_idx
        ON capability_skill_runs (workspace_id, capability_id, created_at DESC);
    `,
  },
  {
    id: '006_capability_run_idempotency',
    sql: `
      ALTER TABLE capability_skill_runs
        ADD COLUMN IF NOT EXISTS idempotency_key text;

      CREATE UNIQUE INDEX IF NOT EXISTS capability_skill_runs_idempotency_idx
        ON capability_skill_runs (workspace_id, capability_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `,
  },
] as const
