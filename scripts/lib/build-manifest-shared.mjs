// Shared building blocks for the add-on manifest builders
// (`catalogs/addons/renodx/lib/build-manifest.mjs` and
// `catalogs/addons/luma/lib/build-manifest.mjs`).
//
// Used by both pipelines:
//   - match-rule uniqueness (`assertUniqueMatchRules`)
//   - status normalization, output id reservation
//
// Tool-specific `buildManifest` / assemble / normalize / `buildStats` stay in
// each catalogue's own `build-manifest.mjs`.

export const MATCH_TIERS = Object.freeze({
  exactIdentity: 100,
  executableEvidence: 70,
});

export function tierForMatchKind(kind) {
  return kind === "exe_name" ? MATCH_TIERS.executableEvidence : MATCH_TIERS.exactIdentity;
}

export const VALID_STATUSES = Object.freeze(
  new Set(["working", "construction", "unknown"]),
);

export function assertUniqueMatchRules(titles, maxDuplicateDetails = 10) {
  const ownersByRule = new Map();

  for (const title of titles) {
    for (const rule of title.match) {
      const key = matchRuleKey(rule);
      const owners = ownersByRule.get(key) ?? [];

      owners.push(title.id);
      ownersByRule.set(key, owners);
    }
  }

  const duplicates = [...ownersByRule.entries()]
    .filter(([, ids]) => ids.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));

  if (duplicates.length === 0) return;

  const details = duplicates
    .slice(0, maxDuplicateDetails)
    .map(([key, ids]) => `${key} -> ${ids.join(", ")}`)
    .join("; ");

  const suffix =
    duplicates.length > maxDuplicateDetails
      ? `; ...and ${duplicates.length - maxDuplicateDetails} more`
      : "";

  throw new Error(`duplicate match rules: ${details}${suffix}`);
}

function matchRuleKey(rule) {
  return `${rule.kind}:${String(rule.value ?? "").toLowerCase()}`;
}

export function normalizedStatus(status, validStatuses) {
  if (typeof status !== "string") {
    return "unknown";
  }

  const normalized = status.trim().toLowerCase();
  return validStatuses.has(normalized) ? normalized : "unknown";
}

export function reserveOutputId(seenIds, id, context) {
  if (seenIds.has(id)) {
    throw new Error(`duplicate title id "${id}" at ${context}`);
  }

  seenIds.add(id);
}
