export const UNCERTAIN_OBJECT_CONFIDENCE = 0.72;

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
  const objectName = detectedObjectName.trim().replace(/\s+/gu, " ");
  if (!title || !objectName || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Card presentation input is invalid");
  }
  if (confidence >= UNCERTAIN_OBJECT_CONFIDENCE) return title;
  return Array.from(`这可能是${objectName}`).slice(0, 30).join("");
}
