import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UsageError } from "../lib/common.mjs";
import {
  collectRegistrySteamAppIds,
  createLumaPendingStore,
  createLumaStoreApi,
  createRenodxStoreApi,
  findTargetIdForSteamAppId,
  validateMatchOverlay,
} from "../lib/pending-match-stores.mjs";
import { runPendingMatching } from "../lib/pending-matching.mjs";
import { filesForTool, parseToolArg } from "../match-pending.mjs";

function registry(targets) {
  return { targets };
}

function target(id, rules = []) {
  return { id, rules };
}

function steamRule(appid) {
  return {
    id: `steam-${appid}`,
    kind: "steam_appid",
    value: appid,
    provenance: { source: "test", locator: `steam:${appid}` },
  };
}

test("parseToolArg exposes only the pending workflows that own central targets", () => {
  assert.deepEqual(parseToolArg([]), {
    help: false,
    tool: "renodx",
    targetIdsByGame: new Map(),
  });
  assert.deepEqual(parseToolArg(["--tool=luma"]), {
    help: false,
    tool: "luma",
    targetIdsByGame: new Map(),
  });
  assert.deepEqual(parseToolArg(["--help"]), {
    help: true,
    tool: "renodx",
    targetIdsByGame: new Map(),
  });
  assert.deepEqual(
    parseToolArg(["--target-id=pending=logical-game"]).targetIdsByGame,
    new Map([["pending", "logical-game"]]),
  );
  assert.throws(() => parseToolArg(["--tool=optiscaler"]), /Unknown --tool/);
  assert.throws(() => parseToolArg(["--target-id=broken"]), /Invalid --target-id/);
  assert.throws(
    () => parseToolArg(["--target-id=pending=one", "--target-id=pending=two"]),
    /Duplicate --target-id/,
  );
  assert.throws(() => parseToolArg(["--wat"]), UsageError);
});

test("filesForTool carries the shared registry alongside add-on authoring", () => {
  for (const tool of ["luma", "renodx"]) {
    const files = filesForTool(tool);
    assert.ok(
      files.matchRegistry.endsWith(path.join("catalogs", "games", "match-registry.json")),
    );
    assert.ok(files.pendingMatch.endsWith(path.join("pending_match.json")));
  }
  assert.equal(filesForTool("luma").matchOverlay, null);
  assert.ok(filesForTool("renodx").matchOverlay.endsWith(path.join("match_overlay.json")));
});

test("Luma pending matching adds a source-provenanced registry fact and target reference", () => {
  const profiles = [{ id: "pending", match_ignore: true }];
  const source = registry([target("pending")]);
  const store = createLumaStoreApi(profiles, source);

  store.applyMatch("pending", "42", "pending");

  assert.deepEqual(profiles, [{ id: "pending", game_target_ids: ["pending"] }]);
  assert.deepEqual(source.targets[0].rules, [
    {
      ...steamRule("42"),
      provenance: { source: "steam-store-search", locator: "pending:luma:pending" },
    },
  ]);
  assert.deepEqual([...store.claimAppIds()], ["42"]);
});

test("Luma pending matching writes its authoring and registry atomically as one pair", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luma-pending-match-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const profiles = path.join(directory, "curated_games.json");
  const matchRegistry = path.join(directory, "match-registry.json");

  await Promise.all([
    fs.writeFile(profiles, JSON.stringify([{ id: "pending" }]), "utf8"),
    fs.writeFile(matchRegistry, JSON.stringify(registry([])), "utf8"),
  ]);
  const store = await createLumaPendingStore({ profiles, matchRegistry });
  store.applyMatch("pending", "42", "pending");
  await store.save();

  assert.deepEqual(JSON.parse(await fs.readFile(profiles, "utf8"))[0].game_target_ids, [
    "pending",
  ]);
  assert.equal(
    JSON.parse(await fs.readFile(matchRegistry, "utf8")).targets[0].rules[0].value,
    "42",
  );
});

test("RenoDX pending matching writes only a target reference and adds the canonical fact", () => {
  const overlay = new Map([
    ["pending", { external: { url: "https://example.com", label_key: "x" } }],
  ]);
  const source = registry([target("pending")]);
  const store = createRenodxStoreApi(overlay, source);

  store.applyMatch("pending", "99", "pending");

  assert.deepEqual(overlay.get("pending"), {
    external: { url: "https://example.com", label_key: "x" },
    game_target_ids: ["pending"],
  });
  assert.equal(source.targets[0].rules[0].value, "99");
  assert.equal(source.targets[0].rules[0].provenance.locator, "pending:renodx:pending");
});

test("RenoDX split pending matching changes the child without creating a synthetic root", () => {
  const parent = { split: [{ suffix: "one", name: "One" }] };
  const overlay = new Map([["collection", parent]]);
  const source = registry([target("collection-one")]);
  const store = createRenodxStoreApi(overlay, source);

  store.applyMatch("collection-one", "101", "collection-one");

  assert.deepEqual(parent.split, [
    { suffix: "one", name: "One", game_target_ids: ["collection-one"] },
  ]);
  assert.equal(overlay.has("collection-one"), false);
  assert.equal(source.targets[0].rules[0].value, "101");
});

test("pending authoring rejects every retired direct game-matching field", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pending-match-legacy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const profiles = path.join(directory, "curated_games.json");
  const matchRegistry = path.join(directory, "match-registry.json");
  await fs.writeFile(matchRegistry, JSON.stringify(registry([])), "utf8");

  const values = {
    match: [],
    appid: "42",
    appids: ["42"],
    exe: "Game.exe",
    exe_name: "Game.exe",
  };
  for (const [field, value] of Object.entries(values)) {
    assert.throws(
      () => validateMatchOverlay({ game: { [field]: value } }, "match_overlay.json"),
      new RegExp(`entry "game"\\.${field} is direct game matching`),
    );
    assert.throws(
      () =>
        validateMatchOverlay(
          { collection: { split: [{ suffix: "child", name: "Child", [field]: value }] } },
          "match_overlay.json",
        ),
      new RegExp(`entry "collection"\\.split\\[0\\]\\.${field} is direct game matching`),
    );
    await fs.writeFile(
      profiles,
      JSON.stringify([{ id: "pending", [field]: value }]),
      "utf8",
    );
    await assert.rejects(
      () => createLumaPendingStore({ profiles, matchRegistry }),
      new RegExp(`item #1\\.${field} is direct game matching`),
    );
  }
});

test("pending matching requires an explicit target for an unbound profile", () => {
  const profiles = [{ id: "pending" }];
  const source = registry([]);
  const store = createLumaStoreApi(profiles, source);

  assert.throws(() => store.applyMatch("pending", "42"), /requires an explicit target id/);
  store.applyMatch("pending", "42", "logical-game");
  assert.deepEqual(profiles, [{ id: "pending", game_target_ids: ["logical-game"] }]);

  const overlay = new Map();
  const renodxStore = createRenodxStoreApi(overlay, registry([]));
  assert.throws(
    () => renodxStore.applyMatch("pending", "42"),
    /requires an explicit target id/,
  );
  assert.equal(overlay.has("pending"), false);
  renodxStore.applyMatch("pending", "42", "logical-game");
  assert.deepEqual(overlay.get("pending"), { game_target_ids: ["logical-game"] });
});

test("pending matching never persists an ambiguous store result", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ambiguous-pending-match-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pendingMatch = path.join(directory, "pending_match.json");
  const unmatched = path.join(directory, "unmatched.json");
  const manifest = path.join(directory, "missing-manifest.json");
  await fs.writeFile(
    pendingMatch,
    JSON.stringify([{ id: "example", name: "Example" }]),
    "utf8",
  );
  const calls = [];

  await runPendingMatching({
    tool: "test",
    files: { pendingMatch, unmatched, manifest },
    createStore: async () => ({
      isResolved: () => false,
      claimAppIds: () => new Set(),
      applyMatch: (...args) => calls.push(args),
      applyDuplicateIgnore: () => assert.fail("must not ignore ambiguous result"),
      save: async () => {},
    }),
    resolveStoreGame: async () => ({
      item: { id: 100, name: "Example - Deluxe", type: "app" },
      ambiguous: true,
    }),
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(await fs.readFile(unmatched, "utf8")), [
    { id: "example", name: "Example", reason: "Ambiguous Steam Store match" },
  ]);
});

test("registry Steam claims are global across all target-authoring workflows", () => {
  assert.deepEqual(
    [
      ...collectRegistrySteamAppIds(
        registry([target("one", [steamRule("10")]), target("two", [steamRule("20")])]),
      ),
    ].sort(),
    ["10", "20"],
  );
});

test("findTargetIdForSteamAppId enforces single-owner invariant and finds target", () => {
  const validRegistry = registry([
    target("game-a", [steamRule("100")]),
    target("game-b", [steamRule("200")]),
  ]);
  assert.equal(findTargetIdForSteamAppId(validRegistry, "100"), "game-a");
  assert.equal(findTargetIdForSteamAppId(validRegistry, "200"), "game-b");
  assert.equal(findTargetIdForSteamAppId(validRegistry, "300"), null);

  const corruptedRegistry = registry([
    target("game-a", [steamRule("100")]),
    target("game-b", [steamRule("100")]),
  ]);
  assert.throws(
    () => findTargetIdForSteamAppId(corruptedRegistry, "100"),
    /Registry invariant violation: Steam AppID 100 is owned by multiple targets/,
  );
});

test("pending matching is non-fatal when explicit target id is missing, matching subsequent games", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "non-fatal-pending-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pendingMatch = path.join(directory, "pending_match.json");
  const unmatched = path.join(directory, "unmatched.json");

  await fs.writeFile(
    pendingMatch,
    JSON.stringify([
      { id: "needs-target", name: "Needs Target" },
      { id: "has-target", name: "Has Target" },
    ]),
    "utf8",
  );

  const overlay = new Map();
  const source = registry([target("has-target")]);
  const store = createRenodxStoreApi(overlay, source);

  await runPendingMatching({
    tool: "renodx",
    files: { pendingMatch, unmatched },
    createStore: async () => ({ ...store, save: async () => {} }),
    resolveStoreGame: async (name) => ({
      item: { id: name === "Needs Target" ? 1000 : 2000, name },
      ambiguous: false,
    }),
  });

  // Second game with existing target was enriched/matched; first game was recorded as unmatched without crash
  assert.deepEqual(overlay.get("has-target"), { game_target_ids: ["has-target"] });
  assert.equal(overlay.has("needs-target"), false);
  const unmatchedData = JSON.parse(await fs.readFile(unmatched, "utf8"));
  assert.deepEqual(unmatchedData, [
    { id: "needs-target", name: "Needs Target", reason: "Requires explicit target id" },
  ]);
});

test("pending matching reuses existing target identity when owner matches entry id", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "reuse-identity-pending-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pendingMatch = path.join(directory, "pending_match.json");
  const unmatched = path.join(directory, "unmatched.json");

  await fs.writeFile(
    pendingMatch,
    JSON.stringify([{ id: "frostpunk-2", name: "Frostpunk 2" }]),
    "utf8",
  );

  const overlay = new Map();
  const source = registry([target("frostpunk-2", [steamRule("1601580")])]);
  const store = createRenodxStoreApi(overlay, source);

  await runPendingMatching({
    tool: "renodx",
    files: { pendingMatch, unmatched },
    createStore: async () => ({ ...store, save: async () => {} }),
    resolveStoreGame: async () => ({
      item: { id: 1601580, name: "Frostpunk 2" },
      ambiguous: false,
    }),
  });

  assert.deepEqual(overlay.get("frostpunk-2"), { game_target_ids: ["frostpunk-2"] });
  // No new rule added since AppID 1601580 was already on the target
  assert.equal(source.targets[0].rules.length, 1);
});

test("pending matching reports target review when AppID belongs to a differently named target", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "review-identity-pending-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pendingMatch = path.join(directory, "pending_match.json");
  const unmatched = path.join(directory, "unmatched.json");

  await fs.writeFile(
    pendingMatch,
    JSON.stringify([
      { id: "ghost-of-tsushima-director-s-cut", name: "Ghost of Tsushima DIRECTOR'S CUT" },
    ]),
    "utf8",
  );

  const overlay = new Map();
  const source = registry([
    target("ghost-of-tsushima-directors-cut", [steamRule("2215430")]),
  ]);
  const store = createRenodxStoreApi(overlay, source);

  await runPendingMatching({
    tool: "renodx",
    files: { pendingMatch, unmatched },
    createStore: async () => ({ ...store, save: async () => {} }),
    resolveStoreGame: async () => ({
      item: { id: 2215430, name: "Ghost of Tsushima DIRECTOR'S CUT" },
      ambiguous: false,
    }),
  });

  // Not automatically merged, not ignored: logged for review
  assert.equal(overlay.has("ghost-of-tsushima-director-s-cut"), false);
  const unmatchedData = JSON.parse(await fs.readFile(unmatched, "utf8"));
  assert.deepEqual(unmatchedData, [
    {
      id: "ghost-of-tsushima-director-s-cut",
      name: "Ghost of Tsushima DIRECTOR'S CUT",
      reason:
        'Target review needed (registered under different id): "ghost-of-tsushima-directors-cut"',
    },
  ]);
});

test("pending matching rejects identity conflict when requested target disagrees with AppID owner", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "conflict-identity-pending-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pendingMatch = path.join(directory, "pending_match.json");
  const unmatched = path.join(directory, "unmatched.json");

  await fs.writeFile(
    pendingMatch,
    JSON.stringify([{ id: "custom-game", name: "Custom Game" }]),
    "utf8",
  );

  const overlay = new Map();
  const source = registry([target("canonical-owner", [steamRule("999")])]);
  const store = createRenodxStoreApi(overlay, source);

  await runPendingMatching({
    tool: "renodx",
    files: { pendingMatch, unmatched },
    targetIdsByGame: new Map([["custom-game", "conflicting-target"]]),
    createStore: async () => ({ ...store, save: async () => {} }),
    resolveStoreGame: async () => ({
      item: { id: 999, name: "Custom Game" },
      ambiguous: false,
    }),
  });

  assert.equal(overlay.has("custom-game"), false);
  const unmatchedData = JSON.parse(await fs.readFile(unmatched, "utf8"));
  assert.deepEqual(unmatchedData, [
    {
      id: "custom-game",
      name: "Custom Game",
      reason: 'Identity conflict with existing target: owned by "canonical-owner"',
    },
  ]);
});

test("pending matching ignores duplicate row when target is already claimed by another entry in catalog", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-row-pending-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pendingMatch = path.join(directory, "pending_match.json");
  const unmatched = path.join(directory, "unmatched.json");

  await fs.writeFile(
    pendingMatch,
    JSON.stringify([{ id: "lords-of-the-fallen", name: "Lords of the Fallen" }]),
    "utf8",
  );

  const overlay = new Map([
    ["lords-of-the-fallen-2023", { game_target_ids: ["lords-of-the-fallen-2023"] }],
  ]);
  const source = registry([target("lords-of-the-fallen-2023", [steamRule("1501750")])]);
  const store = createRenodxStoreApi(overlay, source);

  await runPendingMatching({
    tool: "renodx",
    files: { pendingMatch, unmatched },
    createStore: async () => ({ ...store, save: async () => {} }),
    resolveStoreGame: async () => ({
      item: { id: 1501750, name: "Lords of the Fallen" },
      ambiguous: false,
    }),
  });

  assert.deepEqual(overlay.get("lords-of-the-fallen"), { ignore: true });
});
