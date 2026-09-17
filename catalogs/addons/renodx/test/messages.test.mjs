import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { buildV2Artifacts } from "../lib/build-v2.mjs";

const SCHEMA_PATH = path.join(import.meta.dirname, "..", "messages-source.schema.json");
const MESSAGES_PATH = path.join(import.meta.dirname, "..", "messages.json");
const V1_MANIFEST_PATH = path.join(
  import.meta.dirname,
  "../../../../addons/v1/renodx.json",
);
const V2_MANIFEST_PATH = path.join(
  import.meta.dirname,
  "../../../../addons/v2/renodx.json",
);
const WIKI_GAMES_PATH = path.join(import.meta.dirname, "..", "wiki_games.json");
const WIKI_MESSAGES_PATH = path.join(import.meta.dirname, "..", "wiki_messages.json");
const WIKI_SOURCE_PATH = path.join(import.meta.dirname, "..", "wiki_source.json");

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

const RENODX_LOCALES = Object.freeze([
  "de",
  "es",
  "fr",
  "ja",
  "pt-BR",
  "ru",
  "zh-Hans",
  "zh-Hant",
]);

const MESSAGE_ID_PATTERN = /^[a-z0-9_.-]+$/;

test("RENODX_LOCALES matches messages-source.schema.json required translations", () => {
  const schema = loadJson(SCHEMA_PATH);
  const requiredLocales = schema.properties.messages.items.properties.translations.required;
  assert.deepEqual([...RENODX_LOCALES].sort(), [...requiredLocales].sort());
});

test("messages.json complies with messages-source.schema.json", () => {
  const schema = loadJson(SCHEMA_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(messagesData);
  assert.equal(valid, true, JSON.stringify(validate.errors, null, 2));
});

test("RenoDX messages catalog contains every reviewed message with complete locale coverage", () => {
  const messagesData = loadJson(MESSAGES_PATH);
  assert.equal(messagesData.schema_version, 1);
  assert.ok(Array.isArray(messagesData.messages));
  assert.ok(messagesData.messages.length > 0);

  const seenIds = new Set();
  for (const message of messagesData.messages) {
    assert.ok(message.id, "message must have an id");
    assert.match(
      message.id,
      MESSAGE_ID_PATTERN,
      `message id "${message.id}" does not match pattern`,
    );
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
      [...RENODX_LOCALES].sort(),
      `${message.id} must have exact locale coverage`,
    );

    for (const locale of RENODX_LOCALES) {
      const translation = message.translations[locale];
      assert.ok(
        typeof translation === "string" && translation.trim().length > 0,
        `${message.id} translation for ${locale} must be non-empty string`,
      );
    }

    const ruTranslation = message.translations.ru;
    assert.ok(
      typeof ruTranslation === "string" && ruTranslation.trim().length > 0,
      `${message.id} Russian translation must be non-empty`,
    );

    const deTranslation = message.translations.de;
    assert.ok(
      typeof deTranslation === "string" && deTranslation.trim().length > 0,
      `${message.id} German translation must be non-empty`,
    );

    const frTranslation = message.translations.fr;
    assert.ok(
      typeof frTranslation === "string" && frTranslation.trim().length > 0,
      `${message.id} French translation must be non-empty`,
    );

    const esTranslation = message.translations.es;
    assert.ok(
      typeof esTranslation === "string" && esTranslation.trim().length > 0,
      `${message.id} Spanish translation must be non-empty`,
    );

    const jaTranslation = message.translations.ja;
    assert.ok(
      typeof jaTranslation === "string" && jaTranslation.trim().length > 0,
      `${message.id} Japanese translation must be non-empty`,
    );

    const ptBrTranslation = message.translations["pt-BR"];
    assert.ok(
      typeof ptBrTranslation === "string" && ptBrTranslation.trim().length > 0,
      `${message.id} Brazilian Portuguese translation must be non-empty`,
    );

    const zhHansTranslation = message.translations["zh-Hans"];
    assert.ok(
      typeof zhHansTranslation === "string" && zhHansTranslation.trim().length > 0,
      `${message.id} Simplified Chinese translation must be non-empty`,
    );

    const zhHantTranslation = message.translations["zh-Hant"];
    assert.ok(
      typeof zhHantTranslation === "string" && zhHantTranslation.trim().length > 0,
      `${message.id} Traditional Chinese translation must be non-empty`,
    );
  }
});

test("every v2 manifest guidance item has a corresponding entry in messages.json", () => {
  const manifest = loadJson(V2_MANIFEST_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const messageMap = new Map(messagesData.messages.map((m) => [m.id, m]));

  const guidanceItems = [
    ...manifest.page_guidance,
    ...manifest.engine_profiles.flatMap((p) => [
      ...(p.message ? [p.message] : []),
      ...p.guidance,
    ]),
    ...manifest.games.flatMap((g) => [
      ...(g.availability?.message ? [g.availability.message] : []),
      ...(g.guidance ?? []),
    ]),
  ];

  assert.ok(guidanceItems.length > 0);
  for (const item of guidanceItems) {
    const id = item.message_id || item.id;
    assert.ok(id, `guidance item must have id: ${JSON.stringify(item)}`);
    const catalogEntry = messageMap.get(id);
    assert.ok(catalogEntry, `guidance id "${id}" must exist in messages.json`);
    assert.equal(
      catalogEntry.fallback_text,
      item.fallback_text,
      `fallback_text mismatch for "${id}"`,
    );
  }
});

test("buildV2Artifacts verifies messages catalog and rejects mismatches", () => {
  const v1Manifest = loadJson(V1_MANIFEST_PATH);
  const messagesData = loadJson(MESSAGES_PATH);
  const wikiGames = loadJson(WIKI_GAMES_PATH);
  const wikiMessages = loadJson(WIKI_MESSAGES_PATH);
  const wikiSource = loadJson(WIKI_SOURCE_PATH);

  // Normal build succeeds
  const result = buildV2Artifacts(v1Manifest, {
    wikiGames,
    wikiMessages,
    wikiSource,
    messages: messagesData,
  });
  assert.ok(result.manifest);

  // Rejects missing message
  const missingMessages = {
    ...messagesData,
    messages: messagesData.messages.slice(1),
  };
  assert.throws(
    () =>
      buildV2Artifacts(v1Manifest, {
        wikiGames,
        wikiMessages,
        wikiSource,
        messages: missingMessages,
      }),
    /missing from messages\.json/,
  );

  // Rejects fallback text mismatch
  const targetId = messagesData.messages[0].id;
  const mismatchedFallback = {
    ...messagesData,
    messages: messagesData.messages.map((m) =>
      m.id === targetId ? { ...m, fallback_text: "Corrupted text" } : m,
    ),
  };
  assert.throws(
    () =>
      buildV2Artifacts(v1Manifest, {
        wikiGames,
        wikiMessages,
        wikiSource,
        messages: mismatchedFallback,
      }),
    /fallback_text mismatch/,
  );
});
