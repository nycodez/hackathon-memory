#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f apps/api/.env ]]; then
  cp apps/api/.env.local.example apps/api/.env
  echo "Created apps/api/.env with local development settings."
fi

docker compose up -d postgres

until docker compose exec -T postgres pg_isready -U postgres -d hackathon >/dev/null 2>&1; do
  sleep 1
done

pnpm db:migrate
pnpm db:seed:memory
echo "Local pgvector database and organizational memory demo are ready on localhost:5435."
