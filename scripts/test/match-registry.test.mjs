import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { buildManifest as buildLumaManifest } from "../../catalogs/addons/luma/lib/build-manifest.mjs";
import { buildManifest as buildRenodxManifest } from "../../catalogs/addons/renodx/lib/build-manifest.mjs";
import { inheritedSplitOverlay } from "../../catalogs/addons/renodx/lib/overlay.mjs";
import { buildCompatibilityCatalog } from "../../catalogs/addons/optiscaler/compatibility/lib/build-catalog.mjs";
import { tierForMatchKind } from "../lib/build-manifest-shared.mjs";
import { createMatchRegistry } from "../lib/match-registry.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function readJson(...parts) {
  return JSON.parse(await readFile(path.join(ROOT, ...parts), "utf8"));
}

function expectedMatch(target) {
  return target.rules.map((rule) => ({
    kind: rule.kind,
    value: rule.value,
    tier: tierForMatchKind(rule.kind),
  }));
}

function expectedIdentities(target) {
  return target.rules.map(({ kind, value }) => ({ kind, value }));
}

function outputId(profileId, targetIds, targetId) {
  return targetIds.length === 1 ? profileId : targetId;
}

function assertCanonicalMatch(actual, target, context) {
  assert.deepEqual(
    actual,
    expectedMatch(target),
    `${context} must project its canonical target`,
  );
}

function appendConsumer(consumersByTarget, targetId, match) {
  consumersByTarget.set(targetId, [...(consumersByTarget.get(targetId) ?? []), match]);
}

test("canonical game targets are the sole match source for every add-on", async () => {
  const [
    registrySource,
    lumaCurated,
    lumaMessages,
    renodxWiki,
    renodxCurated,
    renodxOverlay,
    optiscalerSnapshot,
    optiscalerLedger,
    optiscalerCurated,
    optiscalerMessages,
    optiscalerRelease,
  ] = await Promise.all([
    readJson("catalogs", "games", "match-registry.json"),
    readJson("catalogs", "addons", "luma", "curated_games.json"),
    readJson("catalogs", "addons", "luma", "messages.json"),
    readJson("catalogs", "addons", "renodx", "wiki_games.json"),
    readJson("catalogs", "addons", "renodx", "curated_games.json"),
    readJson("catalogs", "addons", "renodx", "match_overlay.json"),
    readJson("catalogs", "addons", "optiscaler", "compatibility", "upstream-snapshot.json"),
    readJson("catalogs", "addons", "optiscaler", "compatibility", "review-ledger.json"),
    readJson("catalogs", "addons", "optiscaler", "compatibility", "curated-games.json"),
    readJson("catalogs", "addons", "optiscaler", "compatibility", "messages.json"),
    readJson("catalogs", "addons", "optiscaler", "manifest-source.json"),
  ]);
  const registry = createMatchRegistry(registrySource);
  const targets = registry.targetsById;
  const allowedKinds = new Set([
    "steam_appid",
    "epic_id",
    "gog_id",
    "xbox_store_id",
    "exe_name",
  ]);
  assert.ok(
    registry.targets
      .flatMap((target) => target.rules)
      .every((rule) => allowedKinds.has(rule.kind)),
    "the registry contains only supported source-level match facts",
  );

  const luma = buildLumaManifest({
    curatedGames: lumaCurated,
    messages: lumaMessages,
    registry,
    generatedAt: "2026-09-10T00:00:00Z",
  }).manifest;
  const lumaById = new Map(luma.games.map((game) => [game.id, game]));
  const consumersByTarget = new Map();
  for (const profile of lumaCurated) {
    if (profile.match_ignore || profile.game_target_ids === undefined) continue;
    for (const targetId of profile.game_target_ids) {
      const game = lumaById.get(outputId(profile.id, profile.game_target_ids, targetId));
      assertCanonicalMatch(game?.match, targets.get(targetId), `Luma ${profile.id}`);
      appendConsumer(
        consumersByTarget,
        targetId,
        game.match.map(({ kind, value }) => ({ kind, value })),
      );
    }
  }

  const renodx = buildRenodxManifest({
    wiki: renodxWiki,
    curatedGames: renodxCurated,
    overlay: renodxOverlay,
    registry,
    generatedAt: "2026-09-10T00:00:00Z",
    warn: () => {},
  }).manifest;
  const renodxById = new Map(renodx.games.map((game) => [game.id, game]));
  const assertRenodxProfile = (profileId, entry) => {
    if (!entry.game_target_ids) return;
    for (const targetId of entry.game_target_ids) {
      const game = renodxById.get(outputId(profileId, entry.game_target_ids, targetId));
      assertCanonicalMatch(game?.match, targets.get(targetId), `RenoDX ${profileId}`);
      appendConsumer(
        consumersByTarget,
        targetId,
        game.match.map(({ kind, value }) => ({ kind, value })),
      );
    }
  };
  for (const [id, entry] of Object.entries(renodxOverlay)) {
    assertRenodxProfile(id, entry);
    for (const split of entry.split ?? []) {
      assertRenodxProfile(`${id}-${split.suffix}`, inheritedSplitOverlay(entry, split));
    }
  }

  const optiscaler = buildCompatibilityCatalog({
    snapshot: optiscalerSnapshot,
    ledger: optiscalerLedger,
    curatedGames: optiscalerCurated,
    messages: optiscalerMessages,
    releaseSource: optiscalerRelease,
    registry,
  }).catalog;
  const optiscalerById = new Map(optiscaler.entries.map((entry) => [entry.id, entry]));
  for (const entry of optiscalerCurated.entries) {
    const target = targets.get(entry.game_target_id);
    const output = optiscalerById.get(entry.id);
    assert.deepEqual(
      output?.identities,
      expectedIdentities(target),
      `OptiScaler ${entry.id} must project its canonical target`,
    );
    appendConsumer(consumersByTarget, entry.game_target_id, output.identities);
  }

  for (const [targetId, matchSets] of consumersByTarget) {
    for (const matchSet of matchSets.slice(1)) {
      assert.deepEqual(matchSet, matchSets[0], `${targetId} has consumer match drift`);
    }
  }
});

function provenance() {
  return { source: "test", locator: "test:fixture" };
}

function rule(id, kind, value) {
  return { id, kind, value, provenance: provenance() };
}

test("registry rejects malformed, duplicate, ambiguous, and unknown match authority", () => {
  assert.throws(
    () => createMatchRegistry({ targets: [], unexpected: true }),
    /must contain only targets/,
  );
  assert.throws(
    () =>
      createMatchRegistry({
        targets: [
          { id: "same", rules: [rule("steam-1", "steam_appid", "1")] },
          { id: "same", rules: [rule("steam-2", "steam_appid", "2")] },
        ],
      }),
    /duplicate target same/,
  );
  assert.throws(
    () =>
      createMatchRegistry({
        targets: [
          { id: "one", rules: [rule("steam-1", "steam_appid", "1")] },
          { id: "two", rules: [rule("steam-2", "steam_appid", "1")] },
        ],
      }),
    /duplicates exact identity steam_appid:1/,
  );
  assert.throws(
    () =>
      createMatchRegistry({
        targets: [{ id: "one", rules: [rule("exe-game", "exe_name", "bin/game.exe")] }],
      }),
    /must be an \.exe basename/,
  );
  assert.throws(
    () =>
      createMatchRegistry({
        targets: [
          { id: "one", rules: [rule("exe-one", "exe_name", "Game.exe")] },
          { id: "two", rules: [rule("exe-two", "exe_name", "game.exe")] },
        ],
      }),
    /cannot project ambiguous executable game\.exe/,
  );
  assert.throws(
    () =>
      createMatchRegistry({
        targets: [{ id: "one", rules: [rule("unknown", "binary_digest", "value")] }],
      }),
    /kind is unsupported: binary_digest/,
  );
});

test("registry schema requires every target to own at least one match fact", async () => {
  const schema = await readJson("catalogs", "games", "match-registry.schema.json");
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  assert.equal(validate({ targets: [{ id: "unmatched", rules: [] }] }), false);
  assert.ok(
    validate.errors?.some((error) => error.keyword === "minItems"),
    "empty target must violate the registry schema",
  );
});

test("registry normalizes exact Xbox StoreIds to its one canonical wire value", () => {
  const registry = createMatchRegistry({
    targets: [
      {
        id: "xbox-game",
        rules: [rule("xbox-9phs0189k408", "xbox_store_id", "9phs0189k408")],
      },
    ],
  });
  assert.equal(registry.targets[0].rules[0].value, "9PHS0189K408");
});
