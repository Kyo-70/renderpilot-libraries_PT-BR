import {
  VALID_STATUSES,
  assertUniqueMatchRules,
  normalizedStatus,
  reserveOutputId,
} from "../../../../scripts/lib/build-manifest-shared.mjs";
import { normalizeCuratedGames } from "./authoring-profile.mjs";
import { SCHEMA_VERSION as V1_SCHEMA_VERSION } from "./v1.mjs";
import { SCHEMA_VERSION as V2_SCHEMA_VERSION } from "./v2.mjs";

// Luma's add-on-loader compatibility floor for reusing an already-present
// ReShade host. Download URLs live in the standalone ReShade v1 catalogue.
export const MIN_RESHADE_VERSION = "6.7.0";

export const LUMA_LOCALES = Object.freeze([
  "de",
  "es",
  "fr",
  "ja",
  "pt-BR",
  "ru",
  "zh-Hans",
  "zh-Hant",
]);

/** Builds both public Luma wire documents from normalized authoring profiles. */
export function buildManifest({ curatedGames, messages, registry, generatedAt } = {}) {
  const profiles = normalizeCuratedGames(curatedGames, registry);
  const games = [];
  const pending = [];
  const seenOutputIds = new Set();

  for (const profile of profiles) {
    if (profile.match_ignore) continue;

    if (profile.target_matches.length === 0) {
      pending.push({
        id: profile.id,
        name: profile.name,
        asset: profile.asset,
        arch: profile.arch,
      });
      continue;
    }

    if (profile.target_matches.length > 1 && profile.guidance.length > 0) {
      throw new Error(
        `curated_games.json "${profile.id}" cannot share guidance across multiple game targets`,
      );
    }

    for (const { targetId, match } of profile.target_matches) {
      const id = profile.target_matches.length === 1 ? profile.id : targetId;
      reserveOutputId(
        seenOutputIds,
        id,
        `curated_games.json "${profile.id}" target "${targetId}"`,
      );
      games.push(assembleGame(profile, { id, match }));
    }
  }

  assertUniqueMatchRules(games);
  assertAssetPayloadIdentity(games);
  assertUniqueGuidanceIds(games);
  validateLumaMessages(messages, games);

  const manifestV2 = {
    schema_version: V2_SCHEMA_VERSION,
    generated_at: generatedAt,
    minimum_reshade_version: MIN_RESHADE_VERSION,
    games,
  };
  const manifestV1 = projectV1Manifest(manifestV2);

  return {
    // `manifest` remains the v1-compatible projection for existing tooling;
    // the generator writes both explicit versioned outputs below.
    manifest: manifestV1,
    manifestV1,
    manifestV2,
    pending,
    stats: buildStats(games, pending),
  };
}

/**
 * Explicitly project the common normalized model to the v1 wire-compatible
 * contract retained for legacy clients. Display `code` remains available to
 * old clients; only the v2 structured mutation authority is omitted.
 */
function projectV1Manifest(manifestV2) {
  return {
    ...manifestV2,
    schema_version: V1_SCHEMA_VERSION,
    games: manifestV2.games.map((game) => ({
      ...game,
      ...(game.guidance
        ? {
            guidance: game.guidance.map(
              ({ engine_ini: _engineIni, ...guidance }) => guidance,
            ),
          }
        : {}),
    })),
  };
}

function assembleGame(profile, { id, match }) {
  const requirements = {};
  if (profile.launch_args.length > 0) {
    requirements.launch_arguments = profile.launch_args;
  }
  if (profile.external_requirement) {
    requirements.managed_dependency = profile.external_requirement;
  }

  const game = {
    id,
    name: profile.name,
    architecture: profile.arch,
    status: normalizedStatus(profile.status, VALID_STATUSES),
    match,
    package: {
      release_asset: profile.asset,
      addon_file: profile.addon_file,
    },
    profile: profile.profile,
  };

  if (profile.blacklist) {
    game.availability = {
      kind: "blocked",
      message: {
        id: profile.blacklist,
        fallback_text: "This Luma profile is unavailable.",
      },
    };
  }

  if (profile.features) game.features = profile.features;
  if (Object.keys(requirements).length > 0) game.requirements = requirements;
  if (profile.guidance.length > 0) game.guidance = profile.guidance;
  return game;
}

function assertAssetPayloadIdentity(games) {
  const payloadByAsset = new Map();
  for (const game of games) {
    const asset = game.package.release_asset;
    const addonFile = game.package.addon_file;
    const previous = payloadByAsset.get(asset);
    if (previous !== undefined && previous !== addonFile) {
      throw new Error(
        `asset "${asset}" maps to multiple root add-ons: "${previous}" and "${addonFile}"`,
      );
    }
    payloadByAsset.set(asset, addonFile);
  }
}

function assertUniqueGuidanceIds(games) {
  const seen = new Map();
  for (const game of games) {
    for (const guidance of game.guidance ?? []) {
      const existing = seen.get(guidance.id);
      if (existing) {
        throw new Error(
          `guidance id "${guidance.id}" is used by both "${existing}" and "${game.id}"`,
        );
      }
      seen.set(guidance.id, game.id);
    }
  }
}

function buildStats(games, pending) {
  return {
    games: games.length,
    pending: pending.length,
    engineProfiles: games.filter((game) => game.profile !== "game").length,
    blacklist: games.filter((game) => game.availability?.kind === "blocked").length,
  };
}

export const LUMA_MESSAGE_ID_PATTERN = /^[a-z0-9_.-]+$/;

function validateLumaMessages(messages, games) {
  if (!messages) {
    throw new Error("Luma messages catalog is required to build the manifest");
  }
  if (messages?.schema_version !== 1 || !Array.isArray(messages.messages)) {
    throw new Error("Luma messages catalog has invalid schema_version or messages array");
  }

  const messageMap = new Map();
  for (const [index, msg] of messages.messages.entries()) {
    if (
      !msg.id ||
      typeof msg.id !== "string" ||
      !msg.id.trim() ||
      !LUMA_MESSAGE_ID_PATTERN.test(msg.id)
    ) {
      throw new Error(
        `Luma message at index ${index} has invalid id: ${JSON.stringify(msg?.id)}`,
      );
    }
    if (messageMap.has(msg.id)) {
      throw new Error(`Duplicate Luma message id: ${msg.id}`);
    }
    if (
      !msg.fallback_text ||
      typeof msg.fallback_text !== "string" ||
      !msg.fallback_text.trim()
    ) {
      throw new Error(`Luma message ${msg.id} missing fallback_text`);
    }
    if (!msg.translations || typeof msg.translations !== "object") {
      throw new Error(`Luma message ${msg.id} missing translations`);
    }
    const locales = Object.keys(msg.translations).sort();
    if (JSON.stringify(locales) !== JSON.stringify([...LUMA_LOCALES].sort())) {
      throw new Error(`Luma message ${msg.id} does not have exact locale coverage`);
    }
    for (const locale of LUMA_LOCALES) {
      if (
        typeof msg.translations[locale] !== "string" ||
        !msg.translations[locale].trim()
      ) {
        throw new Error(`Luma message ${msg.id} translation for ${locale} is empty`);
      }
    }
    messageMap.set(msg.id, msg);
  }

  const usedIds = new Set();
  for (const game of games) {
    for (const guidance of game.guidance ?? []) {
      const msg = messageMap.get(guidance.id);
      if (!msg) {
        throw new Error(
          `Luma guidance id "${guidance.id}" in game "${game.id}" is not in messages.json`,
        );
      }
      if (msg.fallback_text !== guidance.fallback_text) {
        throw new Error(
          `Luma guidance id "${guidance.id}" fallback_text mismatch between curated_games and messages.json`,
        );
      }
      if (msg.kind !== guidance.kind) {
        throw new Error(
          `Luma guidance id "${guidance.id}" kind mismatch between curated_games and messages.json: expected "${guidance.kind}", got "${msg.kind}"`,
        );
      }
      const expectedContext = `guidance.${guidance.kind}`;
      if (msg.context !== expectedContext) {
        throw new Error(
          `Luma guidance id "${guidance.id}" context mismatch: expected "${expectedContext}", got "${msg.context}"`,
        );
      }
      usedIds.add(guidance.id);
    }

    if (game.availability?.message) {
      const availMsg = game.availability.message;
      const msg = messageMap.get(availMsg.id);
      if (!msg) {
        throw new Error(
          `Luma availability message id "${availMsg.id}" in game "${game.id}" is not in messages.json`,
        );
      }
      if (msg.fallback_text !== availMsg.fallback_text) {
        throw new Error(
          `Luma availability message id "${availMsg.id}" fallback_text mismatch between curated_games and messages.json`,
        );
      }
      if (msg.kind !== game.availability.kind) {
        throw new Error(
          `Luma availability message id "${availMsg.id}" kind mismatch: expected "${game.availability.kind}", got "${msg.kind}"`,
        );
      }
      const expectedContext = `availability.${game.availability.kind}`;
      if (msg.context !== expectedContext) {
        throw new Error(
          `Luma availability message id "${availMsg.id}" context mismatch: expected "${expectedContext}", got "${msg.context}"`,
        );
      }
      usedIds.add(availMsg.id);
    }
  }

  for (const id of messageMap.keys()) {
    if (!usedIds.has(id)) {
      throw new Error(
        `Luma message "${id}" in messages.json is not used by any game guidance or availability`,
      );
    }
  }
}
