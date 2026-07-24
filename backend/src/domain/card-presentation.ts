export const UNCERTAIN_OBJECT_CONFIDENCE = 0.72;
const MAX_CARD_TITLE_LENGTH = 30;
const TITLE_TEMPLATES = [
  { prefix: "关于", suffix: "，你可能不知道" },
  { prefix: "", suffix: "的一件小事" },
  { prefix: "原来", suffix: "还有这一面" }
] as const;

/**
 * A title is presentation, not knowledge. Generate it deterministically so a
 * reviewed fact never depends on a second model call, while rotating the safe
 * phrasing between facts for the same object.
 */
export function composeCardTitle(detectedObjectName: string, factId: string): string {
  const objectName = normalizeObjectName(detectedObjectName);
  const stableFactId = factId.trim();
  if (!objectName || !stableFactId) throw new Error("Card presentation input is invalid");

  const template = TITLE_TEMPLATES[stableHash(stableFactId) % TITLE_TEMPLATES.length]!;
  const reservedLength = Array.from(template.prefix + template.suffix).length;
  const visibleObjectName = Array.from(objectName)
    .slice(0, Math.max(1, MAX_CARD_TITLE_LENGTH - reservedLength))
    .join("");
  return `${template.prefix}${visibleObjectName}${template.suffix}`;
}

/**
 * Low-confidence object identity must be expressed by deterministic product policy.
 * A model prompt is not a reliable enforcement boundary for user-facing certainty.
 */
export function cardTitleForConfidence(
  generatedTitle: string,
  detectedObjectName: string,
  confidence: number
): string {
  const title = generatedTitle.trim();
  const objectName = normalizeObjectName(detectedObjectName);
  if (!title || !objectName || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Card presentation input is invalid");
  }
  if (confidence >= UNCERTAIN_OBJECT_CONFIDENCE) return title;
  return Array.from(`这可能是${objectName}`).slice(0, MAX_CARD_TITLE_LENGTH).join("");
}

function normalizeObjectName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function stableHash(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.codePointAt(0)!) >>> 0;
  return hash;
}
