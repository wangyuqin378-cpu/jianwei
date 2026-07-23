# Rejected fact replacement manifests

Human review is expected to reject some facts. A rejected fact cannot be edited back into an
approved fact and cannot be changed by the ordinary draft-correction path. Use a version-controlled
replacement manifest here so the rejection remains attributable while the production catalog gets
a new, non-publishable draft to review.

Each manifest must pin the current catalog version and SHA-256, the rejected fact ID and fact digest,
and a distinct next catalog version. The replacement carries every referenced source record and is
forced to `reviewStatus: "draft"`; the command cannot add a review attestation or approval. Health
and safety replacements still require two authoritative sources.

Generate a fail-closed template first. It copies the rejected fact's sources but leaves the origin,
new fact text and next catalog version as placeholders:

```powershell
node scripts\create-rejected-fact-replacement-batch.mjs `
  --facts rejected-fact-id `
  --batch-id replacement-001 `
  --output knowledge\replacements\replacement-001.json `
  --write
```

After editing the template, preview first, then write atomically:

```powershell
node scripts\apply-rejected-fact-replacements.mjs `
  --manifest knowledge\replacements\batch-001.json
node scripts\apply-rejected-fact-replacements.mjs `
  --manifest knowledge\replacements\batch-001.json `
  --write
```

Keep the applied manifest in version control as the rejection/replacement audit record. Rebuild the
source evidence and review queue after every replacement. The new fact must pass the ordinary human
review batch before it can be published.
