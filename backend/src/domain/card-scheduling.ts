const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Returns the first unoccupied China-calendar day on or after notBefore. */
export function nextAvailableScheduledDate(notBefore: string, occupiedDates: Iterable<string>): string {
  const start = parseIsoDate(notBefore);
  const occupied = new Set(
    [...occupiedDates]
      .filter((value) => ISO_DATE.test(value) && value >= notBefore)
  );
  for (let offset = 0; ; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!occupied.has(candidate)) return candidate;
  }
}

function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new Error("notBefore must be an ISO calendar date");
  if (!isValidIsoCalendarDate(value)) throw new Error("notBefore must be a valid ISO calendar date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed;
}
