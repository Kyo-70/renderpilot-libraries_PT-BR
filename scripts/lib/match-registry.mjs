import { assertPlainObject, requiredNonEmptyString } from "./common.mjs";
import { normalizeAppid, normalizeExeName } from "./overlay-shared.mjs";

export const MATCH_RULE_KINDS = Object.freeze(
  new Set(["steam_appid", "epic_id", "gog_id", "xbox_store_id", "exe_name"]),
);

const IDENTIFIER_RE = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/u;
const XBOX_STORE_ID_RE = /^[A-Z0-9]{12}$/u;
const EXACT_IDENTITY_KINDS = new Set(["steam_appid", "epic_id", "gog_id", "xbox_store_id"]);
const RULE_KIND_ORDER = new Map(
  ["steam_appid", "epic_id", "gog_id", "xbox_store_id", "exe_name"].map((kind, index) => [
    kind,
    index,
  ]),
);

function compareRules(left, right) {
  return (
    RULE_KIND_ORDER.get(left.kind) - RULE_KIND_ORDER.get(right.kind) ||
    String(left.value).localeCompare(String(right.value), "en-US", {
      sensitivity: "base",
    }) ||
    left.id.localeCompare(right.id)
  );
}

function assertIdentifier(value, context) {
  const id = requiredNonEmptyString(value, context);
  if (!IDENTIFIER_RE.test(id)) {
    throw new Error(`${context} must be a stable lowercase identifier`);
  }
  return id;
}

function normalizeRuleValue(kind, value, context) {
  const raw = requiredNonEmptyString(value, context);

  switch (kind) {
    case "steam_appid":
      return normalizeAppid(raw, context);
    case "exe_name": {
      const executable = normalizeExeName(raw, context);
      if (executable === null) throw new Error(`${context} must be an executable leaf`);
      return executable;
    }
    case "xbox_store_id": {
      const storeId = raw.toLocaleUpperCase("en-US");
      if (!XBOX_STORE_ID_RE.test(storeId)) {
        throw new Error(`${context} must be a 12-character Xbox StoreId`);
      }
      return storeId;
    }
    default:
      return raw;
  }
}

export function normalizedRuleKey(kind, value) {
  const normalized = normalizeRuleValue(kind, value, `match rule ${kind}`);
  return `${kind}:${normalized.toLocaleLowerCase("en-US")}`;
}

function validateProvenance(value, context) {
  assertPlainObject(value, context);
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, "source") ||
    !Object.hasOwn(value, "locator")
  ) {
    throw new Error(`${context} must contain only source and locator`);
  }
  return {
    source: requiredNonEmptyString(value.source, `${context}.source`),
    locator: requiredNonEmptyString(value.locator, `${context}.locator`),
  };
}

/**
 * Validates the source-only registry and returns indexes used by catalog
 * builders. A rule is owned by exactly one neutral game/edition target. Store
 * identities are globally unique; executable names intentionally may be shared.
 */
export function createMatchRegistry(value, context = "match-registry.json") {
  assertPlainObject(value, context);
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "targets")) {
    throw new Error(`${context} must contain only targets`);
  }
  if (!Array.isArray(value.targets)) throw new Error(`${context}.targets must be an array`);

  const targetsById = new Map();
  const rulesById = new Map();
  const exactOwnerByKey = new Map();
  const ruleIdsByExecutable = new Map();
  const targets = [];
  let previousTargetId = null;

  for (const [targetIndex, rawTarget] of value.targets.entries()) {
    const targetContext = `${context}.targets[${targetIndex}]`;
    assertPlainObject(rawTarget, targetContext);
    if (
      Object.keys(rawTarget).length !== 2 ||
      !Object.hasOwn(rawTarget, "id") ||
      !Object.hasOwn(rawTarget, "rules")
    ) {
      throw new Error(`${targetContext} must contain only id and rules`);
    }
    const targetId = assertIdentifier(rawTarget.id, `${targetContext}.id`);
    if (targetsById.has(targetId)) {
      throw new Error(`${context}.targets has duplicate target ${targetId}`);
    }
    if (previousTargetId !== null && previousTargetId.localeCompare(targetId) >= 0) {
      throw new Error(`${context}.targets must be ordered by id`);
    }
    previousTargetId = targetId;
    if (!Array.isArray(rawTarget.rules) || rawTarget.rules.length === 0) {
      throw new Error(`${targetContext}.rules must be a non-empty array`);
    }

    const rules = [];
    let previousRule = null;
    for (const [ruleIndex, rawRule] of rawTarget.rules.entries()) {
      const ruleContext = `${targetContext}.rules[${ruleIndex}]`;
      assertPlainObject(rawRule, ruleContext);
      const keys = Object.keys(rawRule).sort();
      if (
        keys.join(",") !== "id,kind,provenance,value" ||
        !Object.hasOwn(rawRule, "id") ||
        !Object.hasOwn(rawRule, "kind") ||
        !Object.hasOwn(rawRule, "value") ||
        !Object.hasOwn(rawRule, "provenance")
      ) {
        throw new Error(`${ruleContext} must contain only id, kind, value, and provenance`);
      }
      const ruleId = assertIdentifier(rawRule.id, `${ruleContext}.id`);
      if (rulesById.has(ruleId)) throw new Error(`${context} has duplicate rule ${ruleId}`);
      const kind = requiredNonEmptyString(rawRule.kind, `${ruleContext}.kind`);
      if (!MATCH_RULE_KINDS.has(kind))
        throw new Error(`${ruleContext}.kind is unsupported: ${kind}`);
      const normalizedValue = normalizeRuleValue(
        kind,
        rawRule.value,
        `${ruleContext}.value`,
      );
      const rule = Object.freeze({
        id: ruleId,
        kind,
        value: normalizedValue,
        provenance: Object.freeze(
          validateProvenance(rawRule.provenance, `${ruleContext}.provenance`),
        ),
        targetId,
      });
      if (previousRule !== null && compareRules(previousRule, rule) >= 0) {
        throw new Error(`${targetContext}.rules must use canonical match ordering`);
      }
      previousRule = rule;

      if (EXACT_IDENTITY_KINDS.has(kind)) {
        const exactKey = `${kind}:${normalizedValue.toLocaleLowerCase("en-US")}`;
        const owner = exactOwnerByKey.get(exactKey);
        if (owner !== undefined) {
          throw new Error(
            `${ruleContext} duplicates exact identity ${exactKey} already owned by ${owner.targetId}.${owner.id}`,
          );
        }
        exactOwnerByKey.set(exactKey, rule);
      }
      if (kind === "exe_name") {
        const key = normalizedValue.toLocaleLowerCase("en-US");
        const ruleIds = ruleIdsByExecutable.get(key) ?? [];
        ruleIds.push(ruleId);
        ruleIdsByExecutable.set(key, ruleIds);
      }
      rules.push(rule);
      rulesById.set(ruleId, rule);
    }
    const target = Object.freeze({ id: targetId, rules: Object.freeze(rules) });
    targets.push(target);
    targetsById.set(targetId, target);
  }

  for (const [executable, ruleIds] of ruleIdsByExecutable) {
    if (ruleIds.length > 1) {
      throw new Error(
        `${context} cannot project ambiguous executable ${executable}: ${ruleIds.join(", ")}`,
      );
    }
  }

  return Object.freeze({
    targets: Object.freeze(targets),
    targetsById,
    rulesById,
    exactOwnerByKey,
    ruleIdsByExecutable,
  });
}

/** Resolves the canonical, source-neutral fact set for one exact game/edition. */
export function resolveTargetRules(registry, targetId, context) {
  if (!registry?.targetsById || !registry?.rulesById) {
    throw new Error(`${context} requires a validated match registry`);
  }
  const normalizedTargetId = assertIdentifier(targetId, `${context}.game_target_id`);
  const target = registry.targetsById.get(normalizedTargetId);
  if (!target) {
    throw new Error(
      `${context}.game_target_id references unknown target ${normalizedTargetId}`,
    );
  }
  return target.rules;
}

/**
 * Resolves the exact targets supported by one add-on policy profile. The
 * association names targets only: facts remain exclusively in this registry.
 */
export function resolveTargetRuleSets(registry, targetIds, context) {
  if (!Array.isArray(targetIds) || targetIds.length === 0) {
    throw new Error(`${context}.game_target_ids must be a non-empty array`);
  }

  const seen = new Set();
  let previous = null;
  return targetIds.map((targetId, index) => {
    const targetContext = `${context}.game_target_ids[${index}]`;
    const normalized = assertIdentifier(targetId, targetContext);
    if (seen.has(normalized)) {
      throw new Error(`${context}.game_target_ids contains duplicate target ${normalized}`);
    }
    if (previous !== null && previous.localeCompare(normalized) >= 0) {
      throw new Error(`${context}.game_target_ids must be ordered by target id`);
    }
    previous = normalized;
    seen.add(normalized);
    return Object.freeze({
      targetId: normalized,
      rules: resolveTargetRules(registry, normalized, context),
    });
  });
}

export function isGloballyUnambiguousExecutableRule(registry, rule) {
  if (rule.kind !== "exe_name") return false;
  const owners =
    registry.ruleIdsByExecutable.get(rule.value.toLocaleLowerCase("en-US")) ?? [];
  return owners.length === 1;
}

function pendingRuleId(kind, value, targetId) {
  switch (kind) {
    case "steam_appid":
      return `steam-${value}`;
    case "epic_id":
      return `epic-${targetId}`;
    case "gog_id":
      return `gog-${targetId}`;
    case "xbox_store_id":
      return `xbox-${value.toLocaleLowerCase("en-US")}`;
    case "exe_name":
      return `exe-name-${targetId}`;
    default:
      throw new Error(`unsupported registry rule kind ${kind}`);
  }
}

function nextAvailableRuleId(registrySource, base) {
  const used = new Set(
    registrySource.targets.flatMap((candidate) =>
      (candidate.rules ?? []).map((rule) => rule.id),
    ),
  );
  if (!used.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Adds a newly verified exact identity during an authoring workflow. The
 * returned registry stays source-only; callers reference the target from their
 * own add-on document.
 */
export function addRegistryRule(registrySource, { targetId, kind, value, provenance }) {
  assertPlainObject(registrySource, "match-registry.json");
  if (!Array.isArray(registrySource.targets)) {
    throw new Error("match-registry.json.targets must be an array");
  }
  const normalizedTargetId = assertIdentifier(targetId, "registry target id");
  if (!MATCH_RULE_KINDS.has(kind))
    throw new Error(`registry rule kind is unsupported: ${kind}`);
  const normalizedValue = normalizeRuleValue(kind, value, `registry ${kind}`);
  const normalizedProvenance = validateProvenance(provenance, "registry provenance");
  let target = registrySource.targets.find((item) => item?.id === normalizedTargetId);
  if (!target) {
    target = { id: normalizedTargetId, rules: [] };
    registrySource.targets.push(target);
  }
  if (!Array.isArray(target.rules))
    throw new Error(`registry target ${normalizedTargetId} has invalid rules`);
  const exact = `${kind}:${normalizedValue.toLocaleLowerCase("en-US")}`;
  for (const candidate of registrySource.targets) {
    for (const rule of candidate?.rules ?? []) {
      if (
        EXACT_IDENTITY_KINDS.has(kind) &&
        rule.kind === kind &&
        String(rule.value).toLocaleLowerCase("en-US") ===
          normalizedValue.toLocaleLowerCase("en-US")
      ) {
        if (candidate.id !== normalizedTargetId) {
          throw new Error(
            `registry exact identity ${exact} is already owned by ${candidate.id}`,
          );
        }
        return rule.id;
      }
    }
  }
  const id = nextAvailableRuleId(
    registrySource,
    pendingRuleId(kind, normalizedValue, normalizedTargetId),
  );
  target.rules.push({ id, kind, value: normalizedValue, provenance: normalizedProvenance });
  target.rules.sort(compareRules);
  registrySource.targets.sort((left, right) => left.id.localeCompare(right.id));
  return id;
}
