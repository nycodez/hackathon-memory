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
    id: '004_task_memory',
    sql: `
      CREATE TABLE IF NOT EXISTS memory_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
        description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS memory_tasks_workspace_name_idx
        ON memory_tasks (workspace_id, lower(name));
      CREATE INDEX IF NOT EXISTS memory_tasks_workspace_updated_idx
        ON memory_tasks (workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS memory_task_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES memory_tasks(id) ON DELETE CASCADE,
        skill_code text NOT NULL CHECK (char_length(skill_code) BETWEEN 1 AND 80),
        position integer NOT NULL CHECK (position >= 0),
        configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (task_id, position)
      );

      CREATE INDEX IF NOT EXISTS memory_task_steps_task_idx
        ON memory_task_steps (task_id, position);
    `,
  },
  {
    id: '005_task_calendar',
    sql: `
      CREATE TABLE IF NOT EXISTS memory_task_schedules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        task_id uuid NOT NULL UNIQUE REFERENCES memory_tasks(id) ON DELETE CASCADE,
        scheduled_for timestamptz NOT NULL,
        timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 80),
        recurrence text NOT NULL DEFAULT 'once' CHECK (
          recurrence IN ('once', 'daily', 'weekly', 'monthly')
        ),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS memory_task_schedules_workspace_time_idx
        ON memory_task_schedules (workspace_id, scheduled_for);
    `,
  },
  {
    id: '006_organizational_memory',
    sql: `
      CREATE TABLE IF NOT EXISTS memory_actors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        slug text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 80),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        title text NOT NULL DEFAULT '',
        email text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'departed')),
        is_demo boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, slug)
      );

      CREATE INDEX IF NOT EXISTS memory_actors_workspace_status_idx
        ON memory_actors (workspace_id, status, name);

      CREATE TABLE IF NOT EXISTS memory_capabilities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        slug text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 100),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        owner_actor_id uuid NOT NULL REFERENCES memory_actors(id),
        steward_actor_id uuid NOT NULL REFERENCES memory_actors(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, slug)
      );

      CREATE INDEX IF NOT EXISTS memory_capabilities_workspace_status_idx
        ON memory_capabilities (workspace_id, status, name);

      CREATE TABLE IF NOT EXISTS memory_capability_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        capability_id uuid NOT NULL REFERENCES memory_capabilities(id) ON DELETE CASCADE,
        version integer NOT NULL CHECK (version > 0),
        change_summary text NOT NULL DEFAULT '',
        created_by_actor_id uuid NOT NULL REFERENCES memory_actors(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_id, version)
      );

      ALTER TABLE memory_capabilities
        ADD COLUMN IF NOT EXISTS active_version_id uuid REFERENCES memory_capability_versions(id);

      CREATE TABLE IF NOT EXISTS memory_capability_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        capability_version_id uuid NOT NULL REFERENCES memory_capability_versions(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK (position >= 0),
        skill_code text NOT NULL CHECK (char_length(skill_code) BETWEEN 1 AND 80),
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        description text NOT NULL DEFAULT '',
        runnable boolean NOT NULL DEFAULT false,
        configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_version_id, position),
        UNIQUE (capability_version_id, skill_code)
      );

      CREATE INDEX IF NOT EXISTS memory_capability_steps_version_idx
        ON memory_capability_steps (capability_version_id, position);

      CREATE TABLE IF NOT EXISTS memory_capability_provenance (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES memory_capabilities(id) ON DELETE CASCADE,
        capability_version_id uuid NOT NULL REFERENCES memory_capability_versions(id) ON DELETE CASCADE,
        source_type text NOT NULL CHECK (source_type IN ('document', 'decision_log', 'interview', 'run')),
        source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 200),
        excerpt text NOT NULL,
        uri text,
        captured_by_actor_id uuid REFERENCES memory_actors(id),
        captured_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_version_id, source_name)
      );

      CREATE INDEX IF NOT EXISTS memory_capability_provenance_capability_idx
        ON memory_capability_provenance (capability_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS memory_capability_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES memory_capabilities(id) ON DELETE CASCADE,
        actor_id uuid NOT NULL REFERENCES memory_actors(id) ON DELETE CASCADE,
        permission text NOT NULL CHECK (permission IN ('view', 'run', 'steward')),
        granted_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (capability_id, actor_id)
      );

      CREATE INDEX IF NOT EXISTS memory_capability_permissions_actor_idx
        ON memory_capability_permissions (workspace_id, actor_id, capability_id);

      CREATE TABLE IF NOT EXISTS memory_capability_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        capability_id uuid NOT NULL REFERENCES memory_capabilities(id),
        capability_version_id uuid NOT NULL REFERENCES memory_capability_versions(id),
        actor_id uuid NOT NULL REFERENCES memory_actors(id),
        idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 120),
        status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'denied')),
        input jsonb NOT NULL DEFAULT '{}'::jsonb,
        output jsonb NOT NULL DEFAULT '{}'::jsonb,
        summary text NOT NULL DEFAULT '',
        citations jsonb NOT NULL DEFAULT '[]'::jsonb,
        decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        UNIQUE (workspace_id, capability_id, actor_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS memory_capability_runs_capability_idx
        ON memory_capability_runs (workspace_id, capability_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS memory_run_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id uuid NOT NULL REFERENCES memory_capability_runs(id) ON DELETE CASCADE,
        capability_step_id uuid NOT NULL REFERENCES memory_capability_steps(id),
        position integer NOT NULL CHECK (position >= 0),
        skill_code text NOT NULL,
        name text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
        input jsonb NOT NULL DEFAULT '{}'::jsonb,
        output jsonb NOT NULL DEFAULT '{}'::jsonb,
        citations jsonb NOT NULL DEFAULT '[]'::jsonb,
        decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
        error_message text,
        started_at timestamptz,
        completed_at timestamptz,
        UNIQUE (run_id, position)
      );

      CREATE INDEX IF NOT EXISTS memory_run_steps_run_idx
        ON memory_run_steps (run_id, position);

      CREATE TABLE IF NOT EXISTS memory_audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        actor_id uuid REFERENCES memory_actors(id),
        action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
        entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 80),
        entity_id uuid,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS memory_audit_events_workspace_idx
        ON memory_audit_events (workspace_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_demo_bills (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        vendor_name text NOT NULL,
        bill_number text NOT NULL,
        property_name text NOT NULL,
        amount_cents integer NOT NULL CHECK (amount_cents > 0),
        due_date date NOT NULL,
        approved boolean NOT NULL DEFAULT false,
        approval_source text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, vendor_name, bill_number)
      );

      CREATE TABLE IF NOT EXISTS memory_demo_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id text NOT NULL,
        bill_id uuid NOT NULL UNIQUE REFERENCES memory_demo_bills(id),
        run_id uuid NOT NULL REFERENCES memory_capability_runs(id),
        payment_reference text NOT NULL,
        amount_cents integer NOT NULL CHECK (amount_cents > 0),
        paid_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, payment_reference)
      );

      ALTER TABLE memory_tasks
        ADD COLUMN IF NOT EXISTS capability_version_id uuid REFERENCES memory_capability_versions(id);

      CREATE INDEX IF NOT EXISTS memory_tasks_capability_version_idx
        ON memory_tasks (workspace_id, capability_version_id);

      CREATE OR REPLACE FUNCTION reject_memory_version_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Published capability versions are immutable';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS memory_capability_versions_immutable ON memory_capability_versions;
      CREATE TRIGGER memory_capability_versions_immutable
        BEFORE UPDATE OR DELETE ON memory_capability_versions
        FOR EACH ROW EXECUTE FUNCTION reject_memory_version_mutation();

      DROP TRIGGER IF EXISTS memory_capability_steps_immutable ON memory_capability_steps;
      CREATE TRIGGER memory_capability_steps_immutable
        BEFORE UPDATE OR DELETE ON memory_capability_steps
        FOR EACH ROW EXECUTE FUNCTION reject_memory_version_mutation();
    `,
  },
  {
    id: '007_memory_discovery_assets',
    sql: `
      ALTER TABLE memory_capability_provenance
        ADD COLUMN IF NOT EXISTS asset_kind text NOT NULL DEFAULT 'best_practice' CHECK (
          asset_kind IN ('prompt', 'workflow', 'agent', 'decision', 'best_practice')
        );

      CREATE INDEX IF NOT EXISTS memory_capability_provenance_asset_idx
        ON memory_capability_provenance (workspace_id, asset_kind, source_name);
    `,
  },
] as const
