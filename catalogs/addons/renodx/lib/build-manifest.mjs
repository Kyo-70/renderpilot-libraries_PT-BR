import {
  categoryOf,
  collectMatchedAppids,
  inheritedSplitOverlay,
  normalizeSlug,
  validateOverlay,
} from "./overlay.mjs";
import {
  SCHEMA_VERSION,
  availabilityFromCategory,
  engineProfileFromGeneric,
} from "./v1.mjs";
import {
  assertPlainObject,
  deepFreeze,
  requiredNonEmptyString,
} from "../../../../scripts/lib/common.mjs";
import {
  VALID_STATUSES,
  assertUniqueMatchRules,
  createDerivedExeResolver,
  makeMatchRules,
  normalizeExeCache,
  normalizedStatus,
  reserveOutputId,
} from "../../../../scripts/lib/build-manifest-shared.mjs";
import {
  normalizeAppids,
  normalizeExeName,
} from "../../../../scripts/lib/overlay-shared.mjs";

export const GENERICS = deepFreeze([
  {
    engine: "unity",
    status: "unknown",
    slug: "unityengine",
    url64:
      "https://github.com/NotVoosh/renodx-unity/releases/download/snapshot/renodx-unityengine.addon64",
    url32:
      "https://github.com/NotVoosh/renodx-unity/releases/download/snapshot/renodx-unityengine.addon32",
    label_key: "renodx.generic.unity",
  },
  {
    engine: "unreal",
    status: "unknown",
    slug: "unrealengine",
    label_key: "renodx.generic.universal",
  },
]);

/**
 * Builds the RenoDX v1 public document from wiki + overlay inputs.
 */
export function buildManifest({
  wiki,
  curatedGames = [],
  overlay = {},
  exeCache = {},
  generatedAt,
  warn = console.warn,
} = {}) {
  const wikiGames = normalizeWikiGames(wiki);
  const normalizedCurated = normalizeCuratedGames(curatedGames);
  const overlayById = assertOverlayShape(overlay);

  const seenInputIds = new Set();
  const allInputGames = [];
  for (const game of [...wikiGames, ...normalizedCurated]) {
    if (seenInputIds.has(game.id)) {
      throw new Error(`Duplicate game id "${game.id}" across wiki and curated inputs`);
    }
    seenInputIds.add(game.id);
    allInputGames.push(game);
  }

  validateOverlay(overlayById, seenInputIds, warn);

  const activeAppids = collectMatchedAppids(allInputGames, overlayById);
  const { exeToAppids, exeCache: normalizedExeCache } = normalizeExeCache(
    exeCache,
    activeAppids,
  );

  const { uniqueExesForAppids, ambiguousDerivedExeKeys } = createDerivedExeResolver(
    normalizedExeCache,
    exeToAppids,
  );

  const games = [];
  const pending = [];
  const seenOutputIds = new Set();

  const emit = ({ id, name, slug, arch, status, entry, downloadUrl, context }) => {
    reserveOutputId(seenOutputIds, id, context);

    const appids = normalizeAppids(entry, context);
    const exe = normalizeExeName(entry.exe, `${context}.exe`);

    if (entry.ignore) {
      // Skip duplicate or broken wiki entries so they don't clutter pending_match.
      return;
    }

    if (appids.length === 0 && !exe) {
      pending.push({ id, name, slug, arch });
      return;
    }

    games.push(
      makeGame({
        id,
        name,
        slug,
        arch,
        status,
        appids,
        exe,
        derivedExes: uniqueExesForAppids(appids),
        overlay: entry,
        category: categoryOf(entry, context),
        downloadUrl,
      }),
    );
  };

  for (const game of allInputGames) {
    const entry = overlayById[game.id] ?? {};
    const baseSlug = normalizeSlug(entry.slug ?? game.slug, `overlay "${game.id}".slug`);

    if (Array.isArray(entry.split)) {
      emitSplits({ game, entry, emit });
      continue;
    }

    emit({
      id: game.id,
      name: game.name,
      slug: baseSlug,
      arch: game.arch,
      status: game.status,
      entry,
      downloadUrl: game.download_url,
      context: `overlay "${game.id}"`,
    });
  }

  assertUniqueMatchRules(games);

  return {
    manifest: {
      schema_version: SCHEMA_VERSION,
      generated_at: generatedAt,
      games,
      engine_profiles: GENERICS.map(engineProfileFromGeneric),
    },
    pending,
    stats: buildStats(games, pending, ambiguousDerivedExeKeys),
  };
}

function emitSplits({ game, entry, emit }) {
  for (const [index, split] of entry.split.entries()) {
    const context = `overlay "${game.id}".split[${index}]`;
    const splitOverlay = inheritedSplitOverlay(entry, split);
    const suffix = requiredNonEmptyString(split.suffix, `${context}.suffix`);
    const name = requiredNonEmptyString(split.name, `${context}.name`);
    const slug = normalizeSlug(splitOverlay.slug ?? game.slug, `${context}.slug`);

    emit({
      id: `${game.id}-${suffix}`,
      name,
      slug,
      arch: game.arch,
      status: game.status,
      entry: splitOverlay,
      downloadUrl: game.download_url,
      context,
    });
  }
}

function makeGame({
  id,
  name,
  slug,
  arch,
  status,
  appids,
  exe,
  derivedExes,
  overlay,
  category,
  downloadUrl,
}) {
  const gameStatus = normalizedStatus(status, VALID_STATUSES);
  const addon = { slug };
  const effectiveDownloadUrl =
    overlay.download_url ??
    downloadUrl ??
    (slug === "ue-extended"
      ? "https://marat569.github.io/renodx/renodx-ue-extended.addon64"
      : undefined);
  if (effectiveDownloadUrl) addon.source = effectiveDownloadUrl;

  const game = {
    id,
    name,
    architecture: arch,
    status: gameStatus,
    match: makeMatchRules({ id, appids, exe, derivedExes }),
    addon,
  };

  const availability = availabilityFromCategory(category);
  if (availability) game.availability = availability;

  const constraints = constraintsFromOverlay(overlay);
  if (constraints) game.constraints = constraints;

  if (overlay.proxy_dll_override) {
    game.proxy_dll = overlay.proxy_dll_override;
  }

  return game;
}

function constraintsFromOverlay(overlay) {
  const constraints = {};

  if (overlay.required_api) {
    constraints.required_api = overlay.required_api;
  }

  if (overlay.conflicts) {
    constraints.conflicts = overlay.conflicts;
  }

  if (overlay.compatibility_source) {
    constraints.source = overlay.compatibility_source;
  }

  return Object.keys(constraints).length > 0 ? constraints : null;
}

function normalizeCuratedGames(curated) {
  if (curated === undefined || curated === null) return [];
  if (!Array.isArray(curated)) {
    throw new Error("curated_games.json must be an array");
  }

  return curated.map((game, index) => {
    const context = `curated_games.json[${index}]`;
    assertPlainObject(game, context);
    return {
      ...game,
      id: requiredNonEmptyString(game.id, `${context}.id`),
      name: requiredNonEmptyString(game.name, `${context}.name`),
      slug: normalizeSlug(
        requiredNonEmptyString(game.slug, `${context}.slug`),
        `${context}.slug`,
      ),
      arch: requiredNonEmptyString(game.arch, `${context}.arch`),
      download_url: game.download_url
        ? requiredNonEmptyString(game.download_url, `${context}.download_url`)
        : undefined,
    };
  });
}

function normalizeWikiGames(wiki) {
  if (!Array.isArray(wiki)) {
    throw new Error("wiki_games.json must be an array");
  }

  return wiki.map((game, index) => normalizeWikiGame(game, index));
}

function normalizeWikiGame(game, index) {
  const context = `wiki_games.json[${index}]`;

  assertPlainObject(game, context);

  return {
    ...game,
    id: requiredNonEmptyString(game.id, `${context}.id`),
    name: requiredNonEmptyString(game.name, `${context}.name`),
    slug: normalizeSlug(
      requiredNonEmptyString(game.slug, `${context}.slug`),
      `${context}.slug`,
    ),
    arch: requiredNonEmptyString(game.arch, `${context}.arch`),
  };
}

function assertOverlayShape(overlay) {
  assertPlainObject(overlay, "match_overlay.json");
  return overlay;
}

function countByAvailabilityKind(games, kind) {
  return games.filter((game) => game.availability?.kind === kind).length;
}

function buildStats(games, pending, ambiguousDerivedExeKeys) {
  return {
    games: games.length,
    pending: pending.length,
    engineProfiles: GENERICS.length,
    ambiguousDerivedExes: ambiguousDerivedExeKeys.size,
    external: countByAvailabilityKind(games, "external"),
    native_hdr: countByAvailabilityKind(games, "native_hdr"),
    blocked: countByAvailabilityKind(games, "blocked"),
  };
}
