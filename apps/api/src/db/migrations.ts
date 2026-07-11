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
] as const
