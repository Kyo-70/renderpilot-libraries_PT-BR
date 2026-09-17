// Typed Engine.ini authoring for RenoDX v2.
//
// A recipe is the execution contract.  Its generated `code` representation is
// deliberately derived from the recipe so presentation and future mutation
// code cannot silently diverge.

const RECIPE_KEYS = new Set(["schema_version", "revision", "sections"]);
const SECTION_KEYS = new Set(["name", "entries"]);
const ENTRY_KEYS = new Set(["key", "value"]);

function assertExactKeys(value, allowed, context) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${context} has unknown field ${key}`);
  }
}

function assertScalar(value, context, invalidCharacters) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-blank string`);
  }
  if (/\r|\n/.test(value)) throw new Error(`${context} must be single-line`);
  if (invalidCharacters && invalidCharacters.test(value)) {
    throw new Error(`${context} contains a forbidden character`);
  }
}

function asciiLower(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Normalizes and validates a v1 Engine.ini recipe while preserving authored
 * section and entry order.  The normalized result is safe to publish as-is.
 */
export function normalizeEngineIniRecipe(value, context = "engine_ini") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  assertExactKeys(value, RECIPE_KEYS, context);
  if (value.schema_version !== 1) {
    throw new Error(`${context}.schema_version must be 1`);
  }
  if (!Number.isInteger(value.revision) || value.revision < 1) {
    throw new Error(`${context}.revision must be an integer greater than zero`);
  }
  if (value.revision > 0xffffffff) {
    throw new Error(`${context}.revision must be no greater than 4294967295`);
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    throw new Error(`${context}.sections must be a non-empty array`);
  }

  const sectionNames = new Set();
  const targets = new Set();
  const sections = value.sections.map((section, sectionIndex) => {
    const sectionContext = `${context}.sections[${sectionIndex}]`;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error(`${sectionContext} must be an object`);
    }
    assertExactKeys(section, SECTION_KEYS, sectionContext);
    assertScalar(section.name, `${sectionContext}.name`, /[\[\]]/);
    const sectionNameKey = asciiLower(section.name);
    if (sectionNames.has(sectionNameKey)) {
      throw new Error(`${context} contains duplicate section names`);
    }
    sectionNames.add(sectionNameKey);
    if (!Array.isArray(section.entries) || section.entries.length === 0) {
      throw new Error(`${sectionContext}.entries must be a non-empty array`);
    }

    const entries = section.entries.map((entry, entryIndex) => {
      const entryContext = `${sectionContext}.entries[${entryIndex}]`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${entryContext} must be an object`);
      }
      assertExactKeys(entry, ENTRY_KEYS, entryContext);
      assertScalar(entry.key, `${entryContext}.key`, /=/);
      assertScalar(entry.value, `${entryContext}.value`);
      // Keep the pair structured while normalizing.  A separator string could
      // collide if a future-safe scalar legitimately contains that separator.
      const target = JSON.stringify([sectionNameKey, asciiLower(entry.key)]);
      if (targets.has(target)) {
        throw new Error(`${context} contains duplicate section/key targets`);
      }
      targets.add(target);
      return { key: entry.key, value: entry.value };
    });

    return { name: section.name, entries };
  });

  return { schema_version: 1, revision: value.revision, sections };
}

/** Renders a normalized recipe in canonical, no-trailing-newline form. */
export function renderEngineIniRecipe(value) {
  const recipe = normalizeEngineIniRecipe(value);
  return recipe.sections
    .map((section) =>
      [
        `[${section.name}]`,
        ...section.entries.map((entry) => `${entry.key}=${entry.value}`),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Defines an immutable reviewed recipe for use by authoring modules. */
export function defineEngineIniRecipe(value) {
  return deepFreeze(normalizeEngineIniRecipe(clone(value)));
}

export const UE_HDR_ENGINE_INI_RECIPE = defineEngineIniRecipe({
  schema_version: 1,
  revision: 1,
  sections: [
    {
      name: "SystemSettings",
      entries: [
        { key: "r.AllowHDR", value: "1" },
        { key: "r.HDR.EnableHDROutput", value: "1" },
        { key: "r.HDR.Display.OutputDevice", value: "3" },
        { key: "r.HDR.Display.ColorGamut", value: "2" },
        { key: "r.HDR.UI.CompositeMode", value: "1" },
      ],
    },
  ],
});

export const UE_LUT_ENGINE_INI_RECIPE = defineEngineIniRecipe({
  schema_version: 1,
  revision: 1,
  sections: [
    {
      name: "/Script/Engine.RendererSettings",
      entries: [{ key: "r.LUT.UpdateEveryFrame", value: "1" }],
    },
  ],
});

/** Creates a reviewed Engine.ini guidance item with canonical presentation code. */
export function engineIniGuidance(text, recipe, condition) {
  const normalized = defineEngineIniRecipe(recipe);
  return {
    kind: "engine_ini",
    fallback_text: text,
    engine_ini: normalized,
    code: renderEngineIniRecipe(normalized),
    ...(condition ? { condition } : {}),
  };
}
