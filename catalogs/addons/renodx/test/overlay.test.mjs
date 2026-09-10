import test from "node:test";
import assert from "node:assert/strict";

import { categoryOf, inheritedSplitOverlay, validateOverlay } from "../lib/overlay.mjs";
import { createMatchRegistry } from "../../../../scripts/lib/match-registry.mjs";

function testRegistry() {
  return createMatchRegistry({
    targets: [
      {
        id: "test-game",
        rules: [
          {
            id: "steam-1",
            kind: "steam_appid",
            value: "1",
            provenance: { source: "test", locator: "test" },
          },
        ],
      },
    ],
  });
}

test("rejects category conflicts and category plus download_url", () => {
  assert.deepEqual(
    categoryOf(
      {
        external: {
          url: "https://discord.gg/example",
          label_key: "renodx.external.discord",
        },
      },
      "overlay",
    ),
    {
      kind: "external",
      url: "https://discord.gg/example",
      label_key: "renodx.external.discord",
    },
  );

  assert.throws(
    () => categoryOf({ external: {}, blacklist: "reason" }, "overlay"),
    /conflicting categories/,
  );
  assert.throws(
    () =>
      categoryOf(
        {
          external: {
            url: "https://discord.gg/example",
            label_key: "renodx.external.discord",
          },
          download_url: "https://example.test/renodx.addon64",
        },
        "overlay",
      ),
    /cannot combine a category with download_url/,
  );
});

test("split overlays inherit policy but not parent game-target references", () => {
  const split = inheritedSplitOverlay(
    {
      game_target_ids: ["parent-game"],
      slug: "sharedslug",
      conflicts: ["SpecialK"],
    },
    {
      suffix: "child",
      name: "Child",
      game_target_ids: ["child-game"],
    },
  );

  assert.deepEqual(split.game_target_ids, ["child-game"]);
  assert.equal(split.slug, "sharedslug");
  assert.deepEqual(split.conflicts, ["SpecialK"]);
});

test("RenoDX overlays and splits reject retired direct game-matching fields", () => {
  const values = {
    match: [],
    appid: "1",
    appids: ["1"],
    exe: "Game.exe",
    exe_name: "Game.exe",
  };

  for (const [field, value] of Object.entries(values)) {
    assert.throws(
      () =>
        validateOverlay(
          {
            game: { game_target_ids: ["test-game"], [field]: value },
          },
          new Set(["game"]),
          testRegistry(),
          () => {},
        ),
      new RegExp(`overlay "game"\\.${field} is direct game matching`),
    );
    assert.throws(
      () =>
        validateOverlay(
          {
            collection: {
              game_target_ids: ["test-game"],
              split: [
                {
                  suffix: "child",
                  name: "Child",
                  game_target_ids: ["test-game"],
                  [field]: value,
                },
              ],
            },
          },
          new Set(["collection"]),
          testRegistry(),
          () => {},
        ),
      new RegExp(`overlay "collection"\\.split\\[0\\]\\.${field} is direct game matching`),
    );
  }
});

test("validateOverlay rejects removed fields that have no publication contract", () => {
  for (const field of ["notes_keys", "min_app_version"]) {
    assert.throws(
      () =>
        validateOverlay(
          {
            game: {
              game_target_ids: ["test-game"],
              [field]: field === "notes_keys" ? ["note.key"] : "1.0.0",
            },
          },
          new Set(["game"]),
          testRegistry(),
          () => {},
        ),
      new RegExp(`${field}.*no RenoDX publication contract`),
    );
  }

  assert.throws(
    () =>
      validateOverlay(
        {
          collection: {
            game_target_ids: ["test-game"],
            split: [
              {
                suffix: "child",
                name: "Child",
                game_target_ids: ["test-game"],
                notes_keys: ["note.key"],
              },
            ],
          },
        },
        new Set(["collection"]),
        testRegistry(),
        () => {},
      ),
    /split\[0\]\.notes_keys.*no RenoDX publication contract/,
  );
});
