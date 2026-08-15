export function mergeObservation(observations, item, { replaceNotExecutedPlaceholder = false } = {}) {
  if (!Array.isArray(observations)) throw new Error("observations moet een array zijn");
  const index = observations.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    observations.push(item);
    return "added";
  }

  const existing = observations[index];
  const evidenceIds = Array.isArray(existing.evidence_ids) ? existing.evidence_ids : [];
  const replaceablePlaceholder = replaceNotExecutedPlaceholder
    && existing.outcome === "not_executed"
    && evidenceIds.length === 0;

  if (!replaceablePlaceholder) throw new Error(`dubbele observatie ${item.id}`);
  observations[index] = item;
  return "replaced";
}
