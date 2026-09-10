import path from "node:path";

import { errorMessage } from "./common.mjs";
import { readJsonFileAsync, writeFormattedJsonFile } from "./json.mjs";
import { resolveSteamStoreGame } from "./steam-search.mjs";

const UNMATCHED_REASON = Object.freeze({
  apiFailed: "API Request Failed",
  noExactMatch: "No exact match found in Steam Store search",
  ambiguousMatch: "Ambiguous Steam Store match",
  requiresTargetId: "Requires explicit target id",
  targetConflict: "Identity conflict with existing target",
  targetReview: "Target review needed (registered under different id)",
});
const STEAM_SEARCH_FAILURE_MESSAGE = "Steam search returned null (all requests failed).";

export async function runPendingMatching({
  tool,
  files,
  createStore,
  targetIdsByGame = new Map(),
  loadPendingGames = readPendingGamesFromFile,
  resolveStoreGame = resolveSteamStoreGame,
}) {
  console.log(`Resolving pending matches for: ${tool}`);

  const pendingGames = validatePendingGames(await loadPendingGames(files));
  const store = await createStore(files);
  const unmatchedGames = [];
  let matchCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const [index, game] of pendingGames.entries()) {
    if (store.isResolved(game.id)) {
      skippedCount++;
      continue;
    }

    console.log(`[${index + 1}/${pendingGames.length}] Checking ${game.name}...`);
    const searchResult = await findExactSteamApp(game.name, resolveStoreGame);

    if (searchResult.kind === "error") {
      console.warn(`  -> Steam search failed: ${errorMessage(searchResult.error)}`);
      unmatchedGames.push({
        id: game.id,
        name: game.name,
        reason: UNMATCHED_REASON.apiFailed,
      });
      continue;
    }
    if (searchResult.kind === "not-found") {
      console.log("  -> No exact match found.");
      unmatchedGames.push({
        id: game.id,
        name: game.name,
        reason: UNMATCHED_REASON.noExactMatch,
      });
      continue;
    }
    if (searchResult.kind === "ambiguous") {
      console.warn(
        `  -> Ambiguous match (score ${searchResult.score}, reason: ${searchResult.reason}). Leaving pending.`,
      );
      unmatchedGames.push({
        id: game.id,
        name: game.name,
        reason: UNMATCHED_REASON.ambiguousMatch,
      });
      continue;
    }

    const appid = String(searchResult.item.id);
    console.log(`  -> Matched Steam AppID ${appid} (${searchResult.item.name})`);

    const requestedTargetId = targetIdsByGame.get(game.id);
    const existingOwnerTargetId = store.getTargetForSteamAppId(appid);

    if (existingOwnerTargetId !== null) {
      // Path A: Existing AppID Owner (Identity already registered)
      if (requestedTargetId && requestedTargetId !== existingOwnerTargetId) {
        console.warn(
          `  -> Identity conflict: AppID ${appid} is owned by target "${existingOwnerTargetId}", but --target-id specified "${requestedTargetId}".`,
        );
        unmatchedGames.push({
          id: game.id,
          name: game.name,
          reason: `${UNMATCHED_REASON.targetConflict}: owned by "${existingOwnerTargetId}"`,
        });
        continue;
      }

      if (store.isTargetClaimedByAnotherEntry(game.id, existingOwnerTargetId)) {
        duplicateCount++;
        console.warn(
          `  -> Warning: Target "${existingOwnerTargetId}" is already claimed by another entry in this catalog. Marking duplicate entry as ignored.`,
        );
        store.applyDuplicateIgnore(game.id, appid);
        continue;
      }

      if (
        requestedTargetId === existingOwnerTargetId ||
        existingOwnerTargetId === game.id
      ) {
        store.linkExistingTarget(game.id, existingOwnerTargetId);
        console.log(`  -> Reused existing registry identity "${existingOwnerTargetId}"`);
        matchCount++;
        continue;
      }

      // Owner target has a different name and was not explicitly confirmed
      console.warn(
        `  -> Target review needed: AppID ${appid} is registered to target "${existingOwnerTargetId}" (entry id: "${game.id}"). Specify --target-id=${game.id}=${existingOwnerTargetId} to confirm.`,
      );
      unmatchedGames.push({
        id: game.id,
        name: game.name,
        reason: `${UNMATCHED_REASON.targetReview}: "${existingOwnerTargetId}"`,
      });
      continue;
    }

    // Path B & C: New AppID (Not yet in registry)
    let targetId = requestedTargetId ?? null;
    let isEnrichment = false;

    if (!targetId && store.hasTarget(game.id)) {
      // Path B: Existing target, enriching with new AppID
      targetId = game.id;
      isEnrichment = true;
    }

    if (!targetId) {
      // Path C without explicit target: refuse silent global target creation
      console.warn(
        `  -> Unresolved: target does not exist for "${game.id}". Specify --target-id=${game.id}=<target-id> to author new identity.`,
      );
      unmatchedGames.push({
        id: game.id,
        name: game.name,
        reason: UNMATCHED_REASON.requiresTargetId,
      });
      continue;
    }

    store.applyMatch(game.id, appid, targetId);
    if (isEnrichment) {
      console.log(`  -> Enriched existing target "${targetId}" with Steam AppID ${appid}`);
    } else {
      console.log(`  -> Authored new identity "${targetId}" with Steam AppID ${appid}`);
    }
    matchCount++;
  }

  await store.save();
  await writeFormattedJsonFile(files.unmatched, unmatchedGames);

  console.log(`\nSuccessfully mapped ${matchCount} Steam games.`);
  console.log(`Skipped ${skippedCount} games that already have a match.`);
  console.log(`Ignored ${duplicateCount} duplicate Steam AppID mappings.`);
  console.log(`Failed to map ${unmatchedGames.length} games (logged to unmatched.json).`);
}

async function readPendingGamesFromFile(files) {
  return readRequiredJson(files.pendingMatch, validatePendingGames);
}

async function findExactSteamApp(gameName, resolveStoreGame) {
  try {
    const resolution = await resolveStoreGame(gameName);

    if (resolution === null) {
      return {
        kind: "error",
        error: new TypeError(STEAM_SEARCH_FAILURE_MESSAGE),
      };
    }

    const { item, ambiguous, score, reason } = resolution;

    if (item === null) {
      return { kind: "not-found" };
    }

    if (ambiguous) {
      return { kind: "ambiguous", item, score, reason };
    }

    return { kind: "match", item };
  } catch (error) {
    return { kind: "error", error };
  }
}

async function readRequiredJson(filePath, validate) {
  const value = await readJsonFileAsync(filePath, path.basename(filePath));
  return validate(value, filePath);
}

export function validatePendingGames(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("pending_match.json must contain an array.");
  }
  const seenIds = new Set();
  return value.map((game, index) => {
    if (!isRecord(game)) {
      throw new TypeError(`pending_match.json item #${index + 1} must be an object.`);
    }
    const id = toNonEmptyString(game.id);
    const name = toNonEmptyString(game.name);
    if (!id)
      throw new TypeError(`pending_match.json item #${index + 1} has an invalid id.`);
    if (!name) {
      throw new TypeError(`pending_match.json item #${index + 1} has an invalid name.`);
    }
    if (seenIds.has(id)) {
      throw new TypeError(`pending_match.json contains duplicate id: ${id}`);
    }
    seenIds.add(id);
    return { ...game, id, name };
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(value) {
  return value == null ? "" : String(value).trim();
}
