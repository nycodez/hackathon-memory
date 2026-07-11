# Architecture

Hackathon Memory extends the existing Learning Library instead of replacing it.

## Boundary

- `knowledge_documents`, `document_chunks`, `library_folders`, and `ingestion_events` remain the only document ingestion and retrieval substrate.
- `capability_*` tables add reusable organizational meaning: assets, versions, provenance, stewardship, decisions, outcomes, installations, runs, and audit events.
- Every searchable capability is linked to one or more Learning Library documents through `capability_asset_documents`.
- There is no second document, chunk, embedding, or folder model.
- The live Vercel API connects to Neon using its pooled `DATABASE_URL`; local development continues to use Dockerized PostgreSQL.

## Request flow

1. The API resolves an allowlisted demo actor from `x-demo-actor-id`.
2. The actor's team, role, status, and clearance are loaded from Postgres.
3. Governance constraints are applied before protected Learning Library chunks are returned.
4. Hybrid lexical/vector retrieval ranks accessible chunks.
5. Capability, outcome, reuse, and graph signals enrich the ranking.
6. The API returns accessible capabilities with citations plus approved locked metadata when requested.
7. Capture, detail, search, install, and run decisions are written to the capability audit log.

## Navigation

The base Learning Library routes appear first: Home, Query, Results, and Library. An HR divider marks the start of the challenge-specific routes: Capabilities, Recommendations, and Skills.

## Demo identity

The browser may select only an allowlisted actor ID. It never supplies authoritative role, team, status, or clearance values. This is intentionally smaller than production authentication while preserving the server-owned authorization boundary.
