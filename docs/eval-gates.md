# Evaluation gates

## Recommendation

- The frozen property-operations task returns `ast-014` in the top three accessible results for Dara.
- At least 8 of 10 deterministic recommendation cases contain an expected capability in the top three.

## Governance

- All deterministic allow/deny cases match the expected decision.
- Direct detail, install, run, and run-detail requests enforce the same policy.
- Locked results contain approved metadata only and expose zero protected chunks.

## Continuity

- Mai is departed and remains the original author.
- Dara is an active, accepted steward.
- Dara can discover, install, and run the current approved version.
- The run contains an authorship and stewardship provenance path.

## Persistence and reuse

- Captured capability content is stored as a Learning Library document and indexed in `document_chunks`.
- Reusing a capture request ID or installation key does not create duplicates.
- Runs persist actor, capability, version, input, output, provenance, and timestamps.
