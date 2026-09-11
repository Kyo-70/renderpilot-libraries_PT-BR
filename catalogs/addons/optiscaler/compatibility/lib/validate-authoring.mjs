import {
  assertPlainObject,
  requiredNonEmptyString,
} from "../../../../../scripts/lib/common.mjs";
import { normalizeWikiText } from "./parse-wiki.mjs";
import { auditCompatibilityReview } from "./reconcile-wiki.mjs";
import {
  isGloballyUnambiguousExecutableRule,
  resolveTargetRules,
} from "../../../../../scripts/lib/match-registry.mjs";

const ID_RE = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/u;
// An entry describes a game/edition, not the storefront identity that happened
// to prove it. Keep the opaque ID portable when later curation adds another
// exact identity for the same game.
const PROVIDER_DERIVED_ENTRY_ID_RE =
  /^(?:steam-\d+-|gog-\d+(?:-|$)|epic-[0-9a-f]{8,}(?:-|$)|exe-[0-9a-f]{64}(?:-|$))/u;
const REVISION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const STATUSES = new Set(["working", "conditional", "unsupported"]);
const INPUTS = new Set(["dlss2_plus", "fsr2_plus", "xess"]);
const GUIDANCE_KINDS = new Set(["warning", "compatibility", "game_setting"]);
const OPTIPATCHER = new Set(["unspecified", "supported", "recommended", "unsupported"]);
const PREREQUISITES = new Set(["none", "luma"]);
// Compatibility variants are evaluated only after an exact game identity has
// matched. Keep this aligned with the Windows launchers that MatchFacts can
// report; Proton, CrossOver, and Whisky remain outside this Windows catalog.
const LAUNCHERS = new Set([
  "steam",
  "epic",
  "gog",
  "ubisoft",
  "ea",
  "battle_net",
  "xbox",
  "manual",
]);
const PROXY_SLOTS = new Set([
  "nvngx.dll",
  "dxgi.dll",
  "winmm.dll",
  "d3d12.dll",
  "version.dll",
  "dbghelp.dll",
  "wininet.dll",
  "winhttp.dll",
]);
const LAUNCH_ARGUMENT_RE = /^-[A-Za-z0-9][A-Za-z0-9._=-]*$/u;
const LOCALES = Object.freeze(["de", "es", "fr", "ja", "ru", "zh-Hans", "zh-Hant"]);

function assertArray(value, context) {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

function assertString(value, context) {
  return requiredNonEmptyString(value, context);
}

function assertId(value, context) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new Error(`${context} must be a stable lowercase identifier`);
  }
  return value;
}

function assertSourceNeutralEntryId(value, context) {
  const id = assertId(value, context);
  if (PROVIDER_DERIVED_ENTRY_ID_RE.test(id)) {
    throw new Error(`${context} must be a source-neutral game or edition slug`);
  }
  return id;
}

function assertUnique(values, context) {
  if (new Set(values).size !== values.length) throw new Error(`${context} has duplicates`);
}

function assertSafeIniAtom(value, context) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0\[\]=]/u.test(value)) {
    throw new Error(`${context} must be a safe INI atom`);
  }
}

function assertSafeIniValue(value, context) {
  if (typeof value !== "string" || /[\r\n\0]/u.test(value)) {
    throw new Error(`${context} must be a safe INI value`);
  }
}

function identityKey(identity) {
  return `${identity.kind}:${identity.value.toLocaleLowerCase("en-US")}`;
}

function validateGuidance(guidance, messages, context) {
  const seen = new Set();
  for (const [index, value] of assertArray(
    guidance ?? [],
    `${context}.guidance`,
  ).entries()) {
    assertPlainObject(value, `${context}.guidance[${index}]`);
    if (!GUIDANCE_KINDS.has(value.kind)) {
      throw new Error(`${context}.guidance[${index}].kind is invalid`);
    }
    const id = assertId(value.message_id, `${context}.guidance[${index}].message_id`);
    if (!messages.has(id))
      throw new Error(`${context}.guidance[${index}] names an unknown message`);
    if (messages.get(id).guidance_kind !== value.kind) {
      throw new Error(`${context}.guidance[${index}] has an incompatible message kind`);
    }
    if (seen.has(id)) throw new Error(`${context}.guidance has duplicate message ${id}`);
    seen.add(id);
  }
  return seen;
}

function validateConditions(value, context) {
  if (value === undefined) return null;
  assertPlainObject(value, `${context}.when`);
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => key !== "launcher" && key !== "executable")) {
    throw new Error(`${context}.when must constrain launcher and/or executable`);
  }
  if (value.launcher !== undefined && !LAUNCHERS.has(value.launcher)) {
    throw new Error(`${context}.when.launcher is invalid`);
  }
  if (
    value.executable !== undefined &&
    (typeof value.executable !== "string" ||
      !/^[^\\/\0]+\.exe$/iu.test(value.executable) ||
      value.executable === ".exe")
  ) {
    throw new Error(`${context}.when.executable must be an executable leaf`);
  }
  return {
    ...(value.launcher !== undefined ? { launcher: value.launcher } : {}),
    ...(value.executable !== undefined
      ? { executable: value.executable.toLocaleLowerCase("en-US") }
      : {}),
  };
}

function conditionsOverlap(left, right) {
  if (!left || !right) return true;
  return !(
    (left.launcher && right.launcher && left.launcher !== right.launcher) ||
    (left.executable && right.executable && left.executable !== right.executable)
  );
}

function validateVariant(value, moduleIds, context) {
  assertPlainObject(value, context);
  const when = validateConditions(value.when, context);
  assertPlainObject(value.proxy, `${context}.proxy`);
  if (value.proxy.kind === "automatic") {
    if (Object.keys(value.proxy).length !== 1)
      throw new Error(`${context}.proxy has extra fields`);
  } else if (value.proxy.kind === "exact") {
    if (Object.keys(value.proxy).length !== 2 || !PROXY_SLOTS.has(value.proxy.slot)) {
      throw new Error(`${context}.proxy.slot is not an approved proxy slot`);
    }
  } else {
    throw new Error(`${context}.proxy.kind is invalid`);
  }

  const iniOverrides = assertArray(value.ini_overrides ?? [], `${context}.ini_overrides`);
  const iniKeys = new Set();
  for (const [index, override] of iniOverrides.entries()) {
    assertPlainObject(override, `${context}.ini_overrides[${index}]`);
    assertSafeIniAtom(override.section, `${context}.ini_overrides[${index}].section`);
    assertSafeIniAtom(override.key, `${context}.ini_overrides[${index}].key`);
    assertSafeIniValue(override.value, `${context}.ini_overrides[${index}].value`);
    const key = `${override.section}\0${override.key}`.toLocaleLowerCase("en-US");
    if (iniKeys.has(key)) throw new Error(`${context} repeats an INI override`);
    iniKeys.add(key);
  }
  let launch = null;
  if (value.launch !== undefined) {
    assertPlainObject(value.launch, `${context}.launch`);
    if (
      Object.keys(value.launch).length !== 2 ||
      !["required", "recommended"].includes(value.launch.requirement)
    ) {
      throw new Error(`${context}.launch must have arguments and a valid requirement`);
    }
    const argumentsValue = assertArray(
      value.launch.arguments,
      `${context}.launch.arguments`,
    );
    if (argumentsValue.length === 0) {
      throw new Error(`${context}.launch.arguments must not be empty`);
    }
    assertUnique(argumentsValue, `${context}.launch.arguments`);
    for (const [index, argument] of argumentsValue.entries()) {
      if (typeof argument !== "string" || !LAUNCH_ARGUMENT_RE.test(argument)) {
        throw new Error(
          `${context}.launch.arguments[${index}] must be a safe launch token`,
        );
      }
    }
    launch = { arguments: [...argumentsValue], requirement: value.launch.requirement };
  }
  const restricted = assertArray(
    value.restricted_modules ?? [],
    `${context}.restricted_modules`,
  );
  assertUnique(restricted.map(String), `${context}.restricted_modules`);
  for (const moduleId of restricted) {
    if (!moduleIds.has(moduleId))
      throw new Error(`${context} restricts unknown module ${moduleId}`);
  }
  if (!OPTIPATCHER.has(value.optipatcher))
    throw new Error(`${context}.optipatcher is invalid`);
  if (!PREREQUISITES.has(value.prerequisite)) {
    throw new Error(`${context}.prerequisite is invalid`);
  }
  return {
    ...(when ? { when } : {}),
    proxy: structuredClone(value.proxy),
    ini_overrides: structuredClone(iniOverrides),
    ...(launch ? { launch } : {}),
    restricted_modules: [...restricted],
    optipatcher: value.optipatcher,
    prerequisite: value.prerequisite,
  };
}

function validateVariants(variants, moduleIds, context) {
  const values = assertArray(variants, `${context}.variants`);
  if (values.length === 0) throw new Error(`${context}.variants must not be empty`);
  const normalized = values.map((value, index) =>
    validateVariant(value, moduleIds, `${context}.variants[${index}]`),
  );
  const defaults = normalized.filter((variant) => !variant.when);
  if (defaults.length !== 1)
    throw new Error(`${context}.variants must have exactly one default`);
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      if (
        normalized[left].when &&
        normalized[right].when &&
        conditionsOverlap(normalized[left].when, normalized[right].when)
      ) {
        throw new Error(`${context}.variants have overlapping conditional policies`);
      }
    }
  }
  return normalized.sort((left, right) => {
    if (!left.when) return -1;
    if (!right.when) return 1;
    return JSON.stringify(left.when).localeCompare(JSON.stringify(right.when));
  });
}

function validateMessages(messageSource, snapshot) {
  assertPlainObject(messageSource, "messages authoring");
  if (messageSource.schema_version !== 1 || !Array.isArray(messageSource.messages)) {
    throw new Error("messages authoring has an invalid schema version or messages field");
  }
  const rawTexts = new Set(
    snapshot.rows.flatMap((row) =>
      [row.title, row.note].filter(Boolean).map(normalizeWikiText),
    ),
  );
  const messages = new Map();
  for (const [index, message] of messageSource.messages.entries()) {
    assertPlainObject(message, `messages[${index}]`);
    const id = assertId(message.id, `messages[${index}].id`);
    if (messages.has(id)) throw new Error(`messages has duplicate id ${id}`);
    if (
      !GUIDANCE_KINDS.has(message.guidance_kind) ||
      message.context !== message.guidance_kind
    ) {
      throw new Error(`messages[${index}] has an invalid context`);
    }
    const fallback = assertString(
      message.fallback_text,
      `messages[${index}].fallback_text`,
    );
    if (rawTexts.has(normalizeWikiText(fallback))) {
      throw new Error(`messages[${index}] copies upstream wiki text`);
    }
    assertPlainObject(message.translations, `messages[${index}].translations`);
    const actualLocales = Object.keys(message.translations).sort();
    if (JSON.stringify(actualLocales) !== JSON.stringify([...LOCALES].sort())) {
      throw new Error(`messages[${index}] does not have exact locale coverage`);
    }
    for (const locale of LOCALES) {
      assertString(
        message.translations[locale],
        `messages[${index}].translations.${locale}`,
      );
    }
    messages.set(id, message);
  }
  return messages;
}

export function validateCompatibilityAuthoring({
  snapshot,
  ledger,
  curatedGames,
  messages,
  releaseSource,
  registry,
}) {
  assertPlainObject(curatedGames, "curated-games.json");
  if (curatedGames.schema_version !== 1 || !REVISION_RE.test(curatedGames.revision ?? "")) {
    throw new Error("curated-games.json has an invalid schema_version or revision");
  }
  if (
    curatedGames.source !== snapshot.source ||
    curatedGames.snapshot_sha256 !== snapshot.snapshot_sha256
  ) {
    throw new Error("curated-games.json is bound to a different upstream snapshot");
  }
  const messageIndex = validateMessages(messages, snapshot);
  const moduleIds = new Set((releaseSource.modules ?? []).map((module) => module.id));
  if (moduleIds.size === 0) throw new Error("release manifest source has no modules");
  const audit = auditCompatibilityReview({ snapshot, ledger, curatedGames });
  const seenIds = new Set();
  const seenIdentities = new Set();
  const usedMessages = new Set();
  const entries = [];
  for (const [index, entry] of assertArray(
    curatedGames.entries,
    "curated-games.entries",
  ).entries()) {
    assertPlainObject(entry, `curated-games.entries[${index}]`);
    const id = assertSourceNeutralEntryId(entry.id, `curated-games.entries[${index}].id`);
    if (seenIds.has(id)) throw new Error(`curated-games.entries has duplicate id ${id}`);
    seenIds.add(id);
    assertString(entry.source_ref, `curated-games.entries[${index}].source_ref`);
    if (!STATUSES.has(entry.status))
      throw new Error(`curated-games.entries[${index}].status is invalid`);
    const rules = resolveTargetRules(
      registry,
      entry.game_target_id,
      `curated-games.entries[${index}]`,
    );
    const identities = rules.map(({ kind, value }) => ({ kind, value }));
    if (identities.length === 0)
      throw new Error(`curated-games.entries[${index}] has no exact identity`);
    for (const rule of rules) {
      if (
        rule.kind === "exe_name" &&
        !isGloballyUnambiguousExecutableRule(registry, rule)
      ) {
        throw new Error(
          `curated-games.entries[${index}].game_target_id cannot use ambiguous executable ${rule.value}`,
        );
      }
    }
    for (const identity of identities) {
      const key = identityKey(identity);
      if (seenIdentities.has(key))
        throw new Error(`duplicate compatibility identity ${key}`);
      seenIdentities.add(key);
    }
    const inputs = assertArray(
      entry.declared_inputs,
      `curated-games.entries[${index}].declared_inputs`,
    );
    assertUnique(inputs, `curated-games.entries[${index}].declared_inputs`);
    for (const input of inputs)
      if (!INPUTS.has(input)) throw new Error(`unknown declared input ${input}`);
    const guidance = validateGuidance(
      entry.guidance,
      messageIndex,
      `curated-games.entries[${index}]`,
    );
    for (const idValue of guidance) {
      if (usedMessages.has(idValue))
        throw new Error(`message ${idValue} is used more than once`);
      usedMessages.add(idValue);
    }
    entries.push({
      id,
      source_ref: entry.source_ref,
      status: entry.status,
      identities,
      declared_inputs: [...inputs].sort(),
      guidance: (entry.guidance ?? []).map((guidanceEntry) => ({
        kind: guidanceEntry.kind,
        message_id: guidanceEntry.message_id,
      })),
      variants: validateVariants(
        entry.variants,
        moduleIds,
        `curated-games.entries[${index}]`,
      ),
    });
  }
  if (usedMessages.size !== messageIndex.size) {
    throw new Error(
      "messages authoring contains an unused or missing published guidance message",
    );
  }
  if (
    usedMessages.size !== audit.guidanceMessageIds.size ||
    [...usedMessages].some((id) => !audit.guidanceMessageIds.has(id))
  ) {
    throw new Error("published guidance is not exactly bound to reviewed upstream notes");
  }
  if (audit.publishedEntryIds.size !== entries.length) {
    throw new Error("review ledger and curated entry count differ");
  }
  return { entries, messageIndex };
}

export { LOCALES };
