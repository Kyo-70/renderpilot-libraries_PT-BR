import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildManifest,
  LUMA_LOCALES,
  LUMA_MESSAGE_ID_PATTERN,
} from "../lib/build-manifest.mjs";
import { createMatchRegistry } from "../../../../scripts/lib/match-registry.mjs";

const MESSAGES_PATH = path.join(import.meta.dirname, "..", "messages.json");
const CURATED_PATH = path.join(import.meta.dirname, "..", "curated_games.json");
const MATCH_REGISTRY_PATH = path.join(
  import.meta.dirname,
  "../../..",
  "games/match-registry.json",
);

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

const SCHEMA_PATH = path.join(import.meta.dirname, "..", "messages-source.schema.json");

test("LUMA_LOCALES matches messages-source.schema.json required translations", () => {
  const schema = loadJson(SCHEMA_PATH);
  const requiredLocales = schema.properties.messages.items.properties.translations.required;
  assert.deepEqual([...LUMA_LOCALES].sort(), [...requiredLocales].sort());
});

test("LUMA_MESSAGE_ID_PATTERN matches messages-source.schema.json id pattern", () => {
  const schema = loadJson(SCHEMA_PATH);
  const idPattern = schema.properties.messages.items.properties.id.pattern;
  assert.ok(idPattern, "schema must define id pattern");
  assert.equal(
    LUMA_MESSAGE_ID_PATTERN.source,
    idPattern,
    "runtime ID pattern must match JSON Schema pattern exactly",
  );
});

test("Luma messages catalog contains every reviewed message with complete locale coverage", () => {
  const messagesData = loadJson(MESSAGES_PATH);
  assert.equal(messagesData.schema_version, 1);
  assert.ok(Array.isArray(messagesData.messages));
  assert.ok(messagesData.messages.length > 0);

  const seenIds = new Set();
  for (const message of messagesData.messages) {
    assert.ok(message.id, "message must have an id");
    assert.ok(!seenIds.has(message.id), `duplicate message id: ${message.id}`);
    seenIds.add(message.id);

    assert.ok(
      message.fallback_text?.trim(),
      `${message.id} fallback_text must not be empty`,
    );
    assert.ok(message.kind, `${message.id} kind must not be empty`);
    assert.ok(message.context, `${message.id} context must not be empty`);
    assert.ok(message.translations, `${message.id} translations must be present`);

    const locales = Object.keys(message.translations).sort();
    assert.deepEqual(
      locales,
      [...LUMA_LOCALES].sort(),
      `${message.id} must have exact locale coverage`,
    );

    for (const locale of LUMA_LOCALES) {
      const translation = message.translations[locale];
      assert.ok(
        typeof translation === "string" && translation.trim().length > 0,
        `${message.id} translation for ${locale} must be non-empty string`,
      );
      assert.notEqual(
        translation.trim(),
        message.fallback_text.trim(),
        `${message.id} translation for ${locale} should not leak English fallback`,
      );
    }
  }
});

test("buildManifest requires messages argument", () => {
  const curatedGames = loadJson(CURATED_PATH);
  const registry = createMatchRegistry(loadJson(MATCH_REGISTRY_PATH));
  assert.throws(
    () => buildManifest({ curatedGames, registry }),
    /Luma messages catalog is required to build the manifest/,
  );
  assert.throws(
    () => buildManifest({ curatedGames, messages: null, registry }),
    /Luma messages catalog is required to build the manifest/,
  );
});

test("buildManifest rejects whitespace or invalid message IDs", () => {
  const curatedGames = loadJson(CURATED_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const registry = createMatchRegistry(loadJson(MATCH_REGISTRY_PATH));
  const badIdMessages = {
    ...messagesData,
    messages: [
      { ...messagesData.messages[0], id: "   " },
      ...messagesData.messages.slice(1),
    ],
  };
  assert.throws(
    () => buildManifest({ curatedGames, messages: badIdMessages, registry }),
    /has invalid id/,
  );
});

test("buildManifest enforces semantic context and kind match for guidance", () => {
  const curatedGames = loadJson(CURATED_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const registry = createMatchRegistry(loadJson(MATCH_REGISTRY_PATH));

  const targetId = "luma.ace-combat-7.engine_ini";
  const targetOriginal = messagesData.messages.find((m) => m.id === targetId);
  assert.ok(targetOriginal, "target message exists");
  assert.equal(targetOriginal.kind, "engine_ini");
  assert.equal(targetOriginal.context, "guidance.engine_ini");

  // Guaranteed kind mismatch: replace engine_ini with warning
  const mismatchKind = {
    ...messagesData,
    messages: messagesData.messages.map((m) =>
      m.id === targetId ? { ...m, kind: "warning" } : m,
    ),
  };
  assert.throws(
    () => buildManifest({ curatedGames, messages: mismatchKind, registry }),
    /kind mismatch.*expected "engine_ini", got "warning"/,
  );

  // Guaranteed context mismatch: replace guidance.engine_ini with guidance.warning
  const mismatchContext = {
    ...messagesData,
    messages: messagesData.messages.map((m) =>
      m.id === targetId ? { ...m, context: "guidance.warning" } : m,
    ),
  };
  assert.throws(
    () => buildManifest({ curatedGames, messages: mismatchContext, registry }),
    /context mismatch.*expected "guidance\.engine_ini", got "guidance\.warning"/,
  );
});

test("buildManifest validates messages.json against curated_games.json guidance", () => {
  const curatedGames = loadJson(CURATED_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const registry = createMatchRegistry(loadJson(MATCH_REGISTRY_PATH));

  // Normal valid build with messages
  const result = buildManifest({ curatedGames, messages: messagesData, registry });
  assert.ok(result.manifest.games.length > 0);

  // Rejects missing message
  const missingMessages = {
    ...messagesData,
    messages: messagesData.messages.slice(1),
  };
  assert.throws(
    () => buildManifest({ curatedGames, messages: missingMessages, registry }),
    /is not in messages\.json/,
  );

  // Rejects orphaned message
  const extraMessages = {
    ...messagesData,
    messages: [
      ...messagesData.messages,
      {
        id: "luma.orphaned.warning",
        fallback_text: "Orphaned warning.",
        kind: "warning",
        context: "guidance.warning",
        translations: Object.fromEntries(LUMA_LOCALES.map((l) => [l, "Translated."])),
      },
    ],
  };
  assert.throws(
    () => buildManifest({ curatedGames, messages: extraMessages, registry }),
    /is not used by any game guidance or availability/,
  );
});

test("buildManifest validates availability messages with availability.blocked context", () => {
  const baseCurated = loadJson(CURATED_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const registry = createMatchRegistry(loadJson(MATCH_REGISTRY_PATH));

  const curatedWithBlocked = [
    ...baseCurated,
    {
      id: "blocked-test-game",
      name: "Blocked Test Game",
      arch: "X64",
      status: "published",
      game_target_ids: ["target-blocked"],
      asset: "Luma-Unreal_Engine.zip",
      addon_file: "Luma-Unreal Engine.addon",
      profile: "unreal",
      features: { dlss_fsr: "supported", hdr: "supported" },
      blacklist: "luma.blocked-game.availability",
      guidance: [],
    },
  ];

  const blockedMessage = {
    id: "luma.blocked-game.availability",
    fallback_text: "This Luma profile is unavailable.",
    kind: "blocked",
    context: "availability.blocked",
    translations: Object.fromEntries(LUMA_LOCALES.map((l) => [l, "Blocked translation."])),
  };

  const messagesWithBlocked = {
    ...messagesData,
    messages: [...messagesData.messages, blockedMessage],
  };

  const allTargets = [
    ...loadJson(MATCH_REGISTRY_PATH).targets,
    {
      id: "target-blocked",
      rules: [
        {
          id: "rule-b",
          kind: "steam_appid",
          value: "999999",
          provenance: { source: "test", locator: "0:0" },
        },
      ],
    },
  ].sort((a, b) => a.id.localeCompare(b.id));

  const registryWithTarget = createMatchRegistry({
    targets: allTargets,
  });

  // Happy path
  const result = buildManifest({
    curatedGames: curatedWithBlocked,
    messages: messagesWithBlocked,
    registry: registryWithTarget,
  });
  const blockedGame = result.manifest.games.find((g) => g.id === "blocked-test-game");
  assert.deepEqual(blockedGame?.availability, {
    kind: "blocked",
    message: {
      id: "luma.blocked-game.availability",
      fallback_text: "This Luma profile is unavailable.",
    },
  });

  // Negative: missing availability message from messages catalog
  assert.throws(
    () =>
      buildManifest({
        curatedGames: curatedWithBlocked,
        messages: messagesData,
        registry: registryWithTarget,
      }),
    /Luma availability message id "luma\.blocked-game\.availability" .* is not in messages\.json/,
  );

  // Negative: fallback_text mismatch
  assert.throws(
    () =>
      buildManifest({
        curatedGames: curatedWithBlocked,
        messages: {
          ...messagesData,
          messages: [
            ...messagesData.messages,
            { ...blockedMessage, fallback_text: "Wrong fallback." },
          ],
        },
        registry: registryWithTarget,
      }),
    /fallback_text mismatch/,
  );

  // Negative: kind mismatch
  assert.throws(
    () =>
      buildManifest({
        curatedGames: curatedWithBlocked,
        messages: {
          ...messagesData,
          messages: [...messagesData.messages, { ...blockedMessage, kind: "warning" }],
        },
        registry: registryWithTarget,
      }),
    /kind mismatch.*expected "blocked", got "warning"/,
  );

  // Negative: context mismatch
  assert.throws(
    () =>
      buildManifest({
        curatedGames: curatedWithBlocked,
        messages: {
          ...messagesData,
          messages: [
            ...messagesData.messages,
            { ...blockedMessage, context: "guidance.warning" },
          ],
        },
        registry: registryWithTarget,
      }),
    /context mismatch.*expected "availability\.blocked", got "guidance\.warning"/,
  );
});
