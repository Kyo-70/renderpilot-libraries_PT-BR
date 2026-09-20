import {
  UNREAL_ASSET,
  UNITY_ASSET,
  UNITY_ASSET_X32,
} from "../../catalogs/addons/luma/lib/v1.mjs";
import { normalizeEngineIniRecipe } from "../../catalogs/addons/engine-ini.mjs";
import { lumaWikiNoteFingerprint, normalizeLumaName } from "./luma-wiki-parser.mjs";

const WIKI_NOTE_SECTIONS = new Set(["completed", "unreal"]);
const SHARED_ENGINE_ASSETS = new Set([UNREAL_ASSET, UNITY_ASSET, UNITY_ASSET_X32]);

const reviewKey = (section, name) => `${section}:${normalizeLumaName(name)}`;

function hasValidTypedEngineIniRecipe(guidance) {
  const recipe = guidance?.engine_ini;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return false;

  try {
    const { id: _recipeId, ...recipeWithoutIdentity } = recipe;
    normalizeEngineIniRecipe(recipeWithoutIdentity, "wiki guidance engine_ini");
    return true;
  } catch {
    return false;
  }
}

export function auditLumaWiki({
  curatedGames,
  candidatesByGame,
  wikiRows,
  notInCurated,
  ambiguous,
  unmatched,
}) {
  return {
    reviewDrift: collectReviewDrift({
      curatedGames,
      candidatesByGame,
      wikiRows,
      notInCurated,
    }),
    completenessIssues: collectCompletenessIssues({
      curatedGames,
      notInCurated,
      ambiguous,
      unmatched,
    }),
  };
}

function collectReviewDrift({
  curatedGames,
  candidatesByGame,
  wikiRows,
  notInCurated = [],
}) {
  const reviewsBySource = new Map();
  const reviewDrift = [];

  for (const game of curatedGames) {
    for (const review of game.wiki_note_reviews ?? []) {
      if (!WIKI_NOTE_SECTIONS.has(review.section)) {
        reviewDrift.push({
          type: "invalid",
          game: game.name,
          reason: "unsupported review section",
        });
        continue;
      }
      const key = reviewKey(review.section, review.name);
      if (reviewsBySource.has(key)) {
        reviewDrift.push({
          type: "duplicate",
          game: game.name,
          section: review.section,
          name: review.name,
        });
      } else {
        reviewsBySource.set(key, { game, review });
      }
    }
  }

  const activeSources = new Set();
  for (const row of wikiRows) {
    if (!row.note || !WIKI_NOTE_SECTIONS.has(row.section)) continue;
    if (row.section === "completed" && !row.asset && notInCurated.includes(row)) continue;
    const key = reviewKey(row.section, row.name);
    activeSources.add(key);
    const entry = reviewsBySource.get(key);
    if (!entry) {
      reviewDrift.push({ type: "missing", section: row.section, name: row.name });
      continue;
    }
    const mappedRows = candidatesByGame.get(entry.game.id) ?? [];
    if (!mappedRows.includes(row)) {
      reviewDrift.push({
        type: "misbound",
        section: row.section,
        name: row.name,
        game: entry.game.name,
      });
      continue;
    }
    if (entry.review.fingerprint !== lumaWikiNoteFingerprint(row.note)) {
      reviewDrift.push({
        type: "changed",
        section: row.section,
        name: row.name,
        game: entry.game.name,
      });
    }
    if (
      row.section === "unreal" &&
      /\bengine\.ini\b/i.test(row.note) &&
      entry.review.disposition !== "omitted" &&
      !(entry.review.guidance_ids ?? []).some((guidanceId) =>
        (entry.game.guidance ?? []).some(
          (guidance) =>
            guidance.id === guidanceId &&
            guidance.kind === "engine_ini" &&
            hasValidTypedEngineIniRecipe(guidance),
        ),
      )
    ) {
      reviewDrift.push({
        type: "missing_typed_engine_ini",
        section: row.section,
        name: row.name,
        game: entry.game.name,
      });
    }
  }

  for (const [key, { game, review }] of reviewsBySource) {
    if (!activeSources.has(key)) {
      reviewDrift.push({
        type: "removed",
        section: review.section,
        name: review.name,
        game: game.name,
      });
    }
  }
  return reviewDrift;
}

function collectCompletenessIssues({ curatedGames, notInCurated, ambiguous, unmatched }) {
  const issues = [];
  for (const row of notInCurated) {
    if (
      row.section === "unreal" ||
      (row.section === "completed" &&
        row.status === "working" &&
        row.asset &&
        !SHARED_ENGINE_ASSETS.has(row.asset))
    ) {
      issues.push({ type: "missing_profile", section: row.section, name: row.name });
    }
  }
  for (const item of ambiguous) {
    issues.push({
      type: "ambiguous_match",
      name: item.row?.name ?? item.game,
      reason: item.reason,
    });
  }
  for (const name of unmatched) {
    const game = curatedGames.find((entry) => entry.name === name);
    if (game?.asset === UNREAL_ASSET) {
      issues.push({ type: "stale_generic_ue_profile", name });
    }
  }
  return issues;
}
