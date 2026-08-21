export const UNCERTAIN_OBJECT_CONFIDENCE = 0.72;
const MAX_CARD_TITLE_LENGTH = 30;
const MIN_REVIEWED_FACT_HEADLINE_LENGTH = 8;
const UNSUITABLE_FACT_HEADLINE = /^(?:它|这|这些|这种|这项|该|如果)/u;
const FACT_HEADLINE_BOUNDARY = /[，,；;。！？!?：:]/u;
const TITLE_TEMPLATES = [
  { prefix: "关于", suffix: "，你可能不知道" },
  { prefix: "", suffix: "的一件小事" },
  { prefix: "原来", suffix: "还有这一面" }
] as const;

/**
 * Prefer the first self-contained clause from the already reviewed fact. This
 * makes the card headline specific without adding a second model call or a new
 * claim. Short, context-dependent, or overlong clauses fall back to bounded
 * object-only presentation text.
 */
export function composeCardTitle(
  detectedObjectName: string,
  factId: string,
  reviewedFactText: string
): string {
  const objectName = normalizeObjectName(detectedObjectName);
  const stableFactId = factId.trim();
  const factText = normalizeFactText(reviewedFactText);
  if (!objectName || !stableFactId || !factText) throw new Error("Card presentation input is invalid");

  const reviewedLead = factText.split(FACT_HEADLINE_BOUNDARY, 1)[0]?.trim() ?? "";
  const reviewedLeadLength = Array.from(reviewedLead).length;
  if (
    reviewedLeadLength >= MIN_REVIEWED_FACT_HEADLINE_LENGTH &&
    reviewedLeadLength <= MAX_CARD_TITLE_LENGTH &&
    !UNSUITABLE_FACT_HEADLINE.test(reviewedLead)
  ) {
    return reviewedLead;
  }

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

function normalizeFactText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function stableHash(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.codePointAt(0)!) >>> 0;
  return hash;
}
