# Topic research drafts

This directory is a staging area, not a production knowledge source. A draft may be prepared by a
human researcher or with AI assistance, but it must never contain `reviewStatus: "approved"` or a
human `review` attestation. Only the separate accountable-human workflow in
`docs/KNOWLEDGE_REVIEW.md` can grant release authority.

Every draft must:

- use a topic from `knowledge/topic-backlog.json`;
- contain 3-5 facts and explicit HTTPS sources;
- identify its origin as `human_research` or `ai_assisted_draft`;
- keep every fact at `reviewStatus: "draft"`;
- give health/safety facts two distinct `official` or `professional` sources.

Validate a draft before review:

```powershell
node scripts\validate-topic-draft.mjs knowledge\drafts\door_handle.json
```

Validation only checks structure and policy. It does not prove that a source supports a claim and
does not import or publish the draft. After validation, intake can merge the topic, sources and
facts into the production catalog as non-publishable drafts:

```powershell
node scripts\ingest-topic-draft.mjs `
  --draft knowledge\drafts\door_handle.json `
  --write
```

The intake command rejects source/fact ID conflicts, malformed baseline catalogs, private/credentialed
source URLs and imports that would take a topic above five total facts. It never imports approval or
review fields and uses an atomic catalog replacement. A separate accountable human must still open
every source, complete a SHA-256-pinned decision template, and apply it atomically with
`scripts/apply-knowledge-review-batch.mjs`.

For a repeatable editorial batch, create a manifest under `knowledge/batches/` with the exact base
catalog version, next catalog version, and 1-20 unique draft paths. Previewing performs every draft
validation and cross-draft conflict check without writing:

```powershell
node scripts\ingest-topic-batch.mjs `
  --manifest knowledge\batches\2026-07-18-digital-02.json
```

After sources have been opened or reachability-checked, commit the whole batch in one catalog
replacement and then regenerate the non-publishing backlog:

```powershell
node scripts\ingest-topic-batch.mjs `
  --manifest knowledge\batches\2026-07-18-digital-02.json `
  --write
node scripts\build-topic-backlog.mjs --write
```

The batch command rejects stale catalog versions, duplicate paths/topics, cross-draft source or fact
conflicts, path traversal and symlink escapes. It validates and merges everything in memory before
one atomic write; a failed batch cannot leave a half-imported catalog. It still forces every fact to
`draft` and cannot grant human review authority.
