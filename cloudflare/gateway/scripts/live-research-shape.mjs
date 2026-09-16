// v18's writer contract has no required applicability field. Keep shape checks
// separate from semantic rejection and do not import the newer client schema.
export function hasLegacyGeneratedFactStructure(raw) {
  return [raw.topicKey, raw.objectName, raw.title, raw.body, raw.evidenceSummary]
    .every(value => typeof value === 'string') &&
    [raw.surprise, raw.aha, raw.retellability, raw.imageConnection]
      .every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Array.isArray(raw.citedSourceIndexes) &&
    raw.citedSourceIndexes.every(value => typeof value === 'number' && Number.isFinite(value)) &&
    (raw.photoRequirement === undefined || raw.photoRequirement === null || typeof raw.photoRequirement === 'string');
}
