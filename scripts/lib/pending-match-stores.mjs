import path from "node:path";

import { isMissingFileError } from "./common.mjs";
import { addRegistryRule, createMatchRegistry } from "./match-registry.mjs";
import {
  readJsonFileAsync,
  stringifyFormattedJson,
  writeJsonFilesBatchWithRollback,
} from "./json.mjs";
import { directGameMatchField, normalizeAppid } from "./overlay-shared.mjs";

export async function createRenodxPendingStore(files) {
  const [matchOverlay, registrySource] = await Promise.all([
    readOptionalJsonFile(
      files.matchOverlay,
      () => new Map(),
      validateMatchOverlay,
      "No existing match_overlay.json found, starting fresh.",
    ),
    readJsonFile(files.matchRegistry, "match-registry.json"),
  ]);
  createMatchRegistry(registrySource);

  return {
    ...createRenodxStoreApi(matchOverlay, registrySource),
    async save() {
      await writeAuthoringPair({
        registryFile: files.matchRegistry,
        registrySource,
        authoringFile: files.matchOverlay,
        authoringSource: mapToSortedObject(matchOverlay),
      });
    },
  };
}

export async function createLumaPendingStore(files) {
  const [profiles, registrySource] = await Promise.all([
    readJsonFile(files.profiles, "curated_games.json"),
    readJsonFile(files.matchRegistry, "match-registry.json"),
  ]);
  validateLumaProfiles(profiles, registrySource);

  return {
    ...createLumaStoreApi(profiles, registrySource),
    async save() {
      await writeAuthoringPair({
        registryFile: files.matchRegistry,
        registrySource,
        authoringFile: files.profiles,
        authoringSource: profiles,
      });
    },
  };
}

export function createRenodxStoreApi(matchOverlay, registrySource) {
  return {
    isResolved(gameId) {
      const target = findRenodxTarget(matchOverlay, gameId);
      return target !== null && hasResolution(target.entry, target.parent);
    },
    claimAppIds() {
      return collectRegistrySteamAppIds(registrySource);
    },
    getTargetForSteamAppId(appid) {
      return findTargetIdForSteamAppId(registrySource, appid);
    },
    hasTarget(targetId) {
      return registrySource.targets?.some((target) => target?.id === targetId) ?? false;
    },
    isTargetClaimedByAnotherEntry(gameId, targetId) {
      for (const [id, entry] of matchOverlay) {
        if (
          id !== gameId &&
          Array.isArray(entry.game_target_ids) &&
          entry.game_target_ids.includes(targetId)
        ) {
          return true;
        }
        for (const split of Array.isArray(entry.split) ? entry.split : []) {
          if (
            `${id}-${split.suffix}` !== gameId &&
            Array.isArray(split.game_target_ids) &&
            split.game_target_ids.includes(targetId)
          ) {
            return true;
          }
        }
      }
      return false;
    },
    linkExistingTarget(gameId, targetId) {
      const target = getOrCreateRenodxTarget(matchOverlay, gameId);
      target.game_target_ids = [targetId];
      delete target.ignore;
    },
    applyMatch(gameId, appid, requestedTargetId) {
      const existing = findRenodxTarget(matchOverlay, gameId);
      const target = existing?.entry ?? {};
      const normalizedAppid = normalizeAppid(appid, `pending match "${gameId}" AppID`);
      const targetId = pendingTargetId(target, gameId, "RenoDX", requestedTargetId);
      addRegistryRule(registrySource, {
        targetId,
        kind: "steam_appid",
        value: normalizedAppid,
        provenance: {
          source: "steam-store-search",
          locator: `pending:renodx:${gameId}`,
        },
      });
      if (existing === null) matchOverlay.set(gameId, target);
      target.game_target_ids = [targetId];
      delete target.ignore;
    },
    applyDuplicateIgnore(gameId) {
      const target = getOrCreateRenodxTarget(matchOverlay, gameId);
      delete target.game_target_ids;
      target.ignore = true;
    },
  };
}

function findRenodxTarget(matchOverlay, gameId) {
  const direct = matchOverlay.get(gameId);
  if (direct) return { entry: direct, parent: null };

  for (const [parentId, parent] of matchOverlay) {
    for (const split of Array.isArray(parent.split) ? parent.split : []) {
      if (isRecord(split) && `${parentId}-${split.suffix}` === gameId) {
        return { entry: split, parent };
      }
    }
  }

  return null;
}

function getOrCreateRenodxTarget(matchOverlay, gameId) {
  const existing = findRenodxTarget(matchOverlay, gameId);
  if (existing) return existing.entry;

  const entry = {};
  matchOverlay.set(gameId, entry);
  return entry;
}

function hasResolution(entry, inherited = null) {
  if (entry.ignore === true || inherited?.ignore === true) return true;
  return Array.isArray(entry.game_target_ids) && entry.game_target_ids.length > 0;
}

export function createLumaStoreApi(profiles, registrySource) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));

  return {
    isResolved(gameId) {
      const profile = byId.get(gameId);
      return Boolean(
        profile &&
        (profile.match_ignore === true ||
          (Array.isArray(profile.game_target_ids) && profile.game_target_ids.length > 0)),
      );
    },
    claimAppIds() {
      return collectRegistrySteamAppIds(registrySource);
    },
    getTargetForSteamAppId(appid) {
      return findTargetIdForSteamAppId(registrySource, appid);
    },
    hasTarget(targetId) {
      return registrySource.targets?.some((target) => target?.id === targetId) ?? false;
    },
    isTargetClaimedByAnotherEntry(gameId, targetId) {
      return profiles.some(
        (profile) =>
          profile.id !== gameId &&
          Array.isArray(profile.game_target_ids) &&
          profile.game_target_ids.includes(targetId),
      );
    },
    linkExistingTarget(gameId, targetId) {
      const profile = requiredProfile(byId, gameId);
      profile.game_target_ids = [targetId];
      delete profile.match_ignore;
    },
    applyMatch(gameId, appid, requestedTargetId) {
      const profile = requiredProfile(byId, gameId);
      const normalizedAppid = normalizeAppid(appid, `pending match "${gameId}" AppID`);
      const targetId = pendingTargetId(profile, gameId, "Luma", requestedTargetId);
      addRegistryRule(registrySource, {
        targetId,
        kind: "steam_appid",
        value: normalizedAppid,
        provenance: {
          source: "steam-store-search",
          locator: `pending:luma:${gameId}`,
        },
      });
      profile.game_target_ids = [targetId];
      delete profile.match_ignore;
    },
    applyDuplicateIgnore(gameId) {
      const profile = requiredProfile(byId, gameId);
      profile.match_ignore = true;
      delete profile.game_target_ids;
    },
  };
}

function requiredProfile(byId, gameId) {
  const profile = byId.get(gameId);
  if (!profile) {
    throw new Error(`curated_games.json has no profile for pending game "${gameId}"`);
  }
  return profile;
}

export function validateMatchOverlay(value, filePath) {
  if (!isRecord(value)) {
    throw new TypeError(`${filePath} must contain an object.`);
  }

  const overlay = new Map();
  for (const [gameId, entry] of Object.entries(value)) {
    validateOverlayEntry(entry, `match_overlay.json entry "${gameId}"`);
    if ("ignore" in entry && typeof entry.ignore !== "boolean") {
      throw new TypeError(`match_overlay.json entry "${gameId}".ignore must be boolean.`);
    }
    overlay.set(String(gameId), structuredClone(entry));
  }
  return overlay;
}

export function collectRegistrySteamAppIds(registrySource) {
  const registry = createMatchRegistry(registrySource);
  return new Set(
    registry.targets.flatMap((target) =>
      target.rules.filter((rule) => rule.kind === "steam_appid").map((rule) => rule.value),
    ),
  );
}

export function findTargetIdForSteamAppId(registrySource, appid) {
  const normalized = String(appid).trim();
  const owners = [];
  for (const target of registrySource?.targets ?? []) {
    if (
      target?.rules?.some(
        (rule) => rule?.kind === "steam_appid" && String(rule.value).trim() === normalized,
      )
    ) {
      owners.push(target.id);
    }
  }
  if (owners.length > 1) {
    throw new Error(
      `Registry invariant violation: Steam AppID ${normalized} is owned by multiple targets: ${owners.join(", ")}`,
    );
  }
  return owners[0] ?? null;
}

function validateLumaProfiles(value, registrySource) {
  if (!Array.isArray(value)) {
    throw new TypeError("curated_games.json must contain an array.");
  }
  const registry = createMatchRegistry(registrySource);
  const ids = new Set();
  for (const [index, profile] of value.entries()) {
    if (!isRecord(profile)) {
      throw new TypeError(`curated_games.json item #${index + 1} must be an object.`);
    }
    const id = String(profile.id ?? "").trim();
    if (!id || ids.has(id)) {
      throw new TypeError(
        `curated_games.json contains an invalid or duplicate id at #${index + 1}.`,
      );
    }
    ids.add(id);
    if (profile.match_ignore !== undefined && typeof profile.match_ignore !== "boolean") {
      throw new TypeError(
        `curated_games.json item #${index + 1}.match_ignore must be boolean.`,
      );
    }
    if (profile.game_target_id !== undefined) {
      throw new TypeError(
        `curated_games.json item #${index + 1} must use game_target_ids instead of game_target_id.`,
      );
    }
    rejectRetiredDirectMatchFields(profile, `curated_games.json item #${index + 1}`);
    if (profile.game_target_ids !== undefined) {
      validateTargetIds(
        profile.game_target_ids,
        registry,
        `curated_games.json item #${index + 1}`,
      );
    }
  }
}

function pendingTargetId(entry, gameId, addon, requestedTargetId) {
  if (entry.game_target_id !== undefined) {
    throw new TypeError(`${addon} pending entry ${gameId} uses obsolete game_target_id.`);
  }
  if (entry.game_target_ids === undefined) {
    if (typeof requestedTargetId !== "string" || requestedTargetId.trim() === "") {
      throw new TypeError(
        `${addon} pending entry ${gameId} requires an explicit target id before adding an identity.`,
      );
    }
    return requestedTargetId.trim();
  }
  if (!Array.isArray(entry.game_target_ids) || entry.game_target_ids.length !== 1) {
    throw new TypeError(
      `${addon} pending entry ${gameId} cannot add an identity to a shared target profile.`,
    );
  }
  if (
    requestedTargetId !== undefined &&
    (typeof requestedTargetId !== "string" ||
      requestedTargetId.trim() !== entry.game_target_ids[0])
  ) {
    throw new TypeError(
      `${addon} pending entry ${gameId} already references ${entry.game_target_ids[0]}; target id must agree.`,
    );
  }
  return entry.game_target_ids[0];
}

function validateOverlayEntry(entry, context) {
  if (!isRecord(entry)) {
    throw new TypeError(`${context} must be an object.`);
  }
  rejectRetiredDirectMatchFields(entry, context);
  if (entry.split === undefined) return;
  if (!Array.isArray(entry.split)) {
    throw new TypeError(`${context}.split must be an array when present.`);
  }
  entry.split.forEach((split, index) => {
    validateOverlayEntry(split, `${context}.split[${index}]`);
  });
}

function rejectRetiredDirectMatchFields(entry, context) {
  const field = directGameMatchField(entry);
  if (field !== null) {
    throw new TypeError(
      `${context}.${field} is direct game matching; use game_target_ids.`,
    );
  }
}

function validateTargetIds(value, registry, context) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${context}.game_target_ids must be a non-empty array.`);
  }
  const seen = new Set();
  let previous = null;
  for (const targetId of value) {
    if (typeof targetId !== "string" || !registry.targetsById.has(targetId)) {
      throw new TypeError(`${context}.game_target_ids has an unknown target.`);
    }
    if (
      seen.has(targetId) ||
      (previous !== null && previous.localeCompare(targetId) >= 0)
    ) {
      throw new TypeError(`${context}.game_target_ids must be unique and ordered.`);
    }
    seen.add(targetId);
    previous = targetId;
  }
}

async function writeAuthoringPair({
  registryFile,
  registrySource,
  authoringFile,
  authoringSource,
}) {
  createMatchRegistry(registrySource);
  const [registryBody, authoringBody] = await Promise.all([
    stringifyFormattedJson(registrySource, registryFile),
    stringifyFormattedJson(authoringSource, authoringFile),
  ]);
  await writeJsonFilesBatchWithRollback([
    { file: registryFile, body: registryBody },
    { file: authoringFile, body: authoringBody },
  ]);
}

async function readJsonFile(file, context) {
  return readJsonFileAsync(file, context);
}

async function readOptionalJsonFile(file, fallback, validate, missingMessage) {
  try {
    return validate(await readJsonFile(file, path.basename(file)), path.basename(file));
  } catch (error) {
    if (isMissingFileError(error)) {
      console.log(missingMessage);
      return fallback();
    }
    throw error;
  }
}

function mapToSortedObject(map) {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
