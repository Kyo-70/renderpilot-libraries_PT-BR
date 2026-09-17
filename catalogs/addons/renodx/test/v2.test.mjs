import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { guidanceForWikiGame, verifyCurationLedger } from "../lib/curation.mjs";
import {
  normalizeEngineIniRecipe,
  renderEngineIniRecipe,
  UE_HDR_ENGINE_INI_RECIPE,
} from "../lib/engine-ini.mjs";
import { normalizeGuidance } from "../lib/build-v2.mjs";

const wiki = JSON.parse(readFileSync(new URL("../wiki_games.json", import.meta.url)));
const messages = JSON.parse(
  readFileSync(new URL("../wiki_messages.json", import.meta.url)),
);
const wikiSource = JSON.parse(
  readFileSync(new URL("../wiki_source.json", import.meta.url)),
);
const manifest = JSON.parse(
  readFileSync(new URL("../../../../addons/v2/renodx.json", import.meta.url)),
);
const ledger = JSON.parse(readFileSync(new URL("../review-ledger.json", import.meta.url)));
const schema = JSON.parse(
  readFileSync(new URL("../manifest-v2.schema.json", import.meta.url)),
);

function compileV2Schema() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

const emptyManifest = () => ({
  schema_version: 2,
  generated_at: "2026-09-15T00:00:00Z",
  games: [],
  engine_profiles: [],
  page_guidance: [],
});

const validRecipe = () => ({
  schema_version: 1,
  revision: 1,
  sections: [
    {
      name: "SystemSettings",
      entries: [{ key: "r.AllowHDR", value: "1" }],
    },
  ],
});

const validEngineIniGuidance = () => ({
  id: "recipe",
  kind: "engine_ini",
  message_id: "recipe",
  fallback_text: "Apply this Engine.ini recipe.",
  code: "[SystemSettings]\nr.AllowHDR=1",
  engine_ini: validRecipe(),
});

test("v2 schema publishes a closed structured Engine.ini recipe contract", () => {
  const validate = compileV2Schema();
  const accepted = emptyManifest();
  accepted.page_guidance.push(validEngineIniGuidance());
  assert.equal(validate(accepted), true, JSON.stringify(validate.errors, null, 2));

  const wrongKind = emptyManifest();
  wrongKind.page_guidance.push({ ...validEngineIniGuidance(), kind: "warning" });
  assert.equal(validate(wrongKind), false);

  const unknownRecipeField = emptyManifest();
  unknownRecipeField.page_guidance.push({
    ...validEngineIniGuidance(),
    engine_ini: { ...validRecipe(), unexpected: true },
  });
  assert.equal(validate(unknownRecipeField), false);

  const nullRecipe = emptyManifest();
  nullRecipe.page_guidance.push({ ...validEngineIniGuidance(), engine_ini: null });
  assert.equal(validate(nullRecipe), false);

  const maxRevision = emptyManifest();
  maxRevision.page_guidance.push({
    ...validEngineIniGuidance(),
    engine_ini: { ...validRecipe(), revision: 4294967295 },
  });
  assert.equal(validate(maxRevision), true, JSON.stringify(validate.errors, null, 2));

  const overflowingRevision = emptyManifest();
  overflowingRevision.page_guidance.push({
    ...validEngineIniGuidance(),
    engine_ini: { ...validRecipe(), revision: 4294967296 },
  });
  assert.equal(validate(overflowingRevision), false);

  const invalidScalar = emptyManifest();
  invalidScalar.page_guidance.push({
    ...validEngineIniGuidance(),
    engine_ini: {
      ...validRecipe(),
      sections: [{ ...validRecipe().sections[0], name: "System\nSettings" }],
    },
  });
  assert.equal(validate(invalidScalar), false);
});

test("Engine.ini recipe helper is deterministic, strict, and canonical", () => {
  assert.equal(
    renderEngineIniRecipe({
      schema_version: 1,
      revision: 4,
      sections: [
        { name: "First", entries: [{ key: "a", value: "1" }] },
        { name: "Second", entries: [{ key: "b", value: "2" }] },
      ],
    }),
    "[First]\na=1\n\n[Second]\nb=2",
  );
  assert.equal(renderEngineIniRecipe(UE_HDR_ENGINE_INI_RECIPE).endsWith("\n"), false);

  assert.throws(
    () => normalizeEngineIniRecipe({ ...validRecipe(), revision: 0 }),
    /revision must be an integer greater than zero/,
  );
  assert.equal(
    renderEngineIniRecipe({ ...validRecipe(), revision: 4294967295 }),
    "[SystemSettings]\nr.AllowHDR=1",
  );
  assert.throws(
    () => normalizeEngineIniRecipe({ ...validRecipe(), revision: 4294967296 }),
    /revision must be no greater than 4294967295/,
  );
  assert.throws(
    () =>
      normalizeEngineIniRecipe({
        ...validRecipe(),
        sections: [
          ...validRecipe().sections,
          { name: "systemsettings", entries: [{ key: "other", value: "1" }] },
        ],
      }),
    /duplicate section names/,
  );
  assert.throws(
    () =>
      normalizeEngineIniRecipe({
        ...validRecipe(),
        sections: [
          {
            name: "SystemSettings",
            entries: [
              { key: "r.AllowHDR", value: "1" },
              { key: "R.ALLOWHDR", value: "1" },
            ],
          },
        ],
      }),
    /duplicate section\/key targets/,
  );
});

test("structured guidance rejects presentation-code drift", () => {
  const guidance = validEngineIniGuidance();
  guidance.code = "[SystemSettings]\nr.AllowHDR=0";
  assert.throws(
    () => normalizeGuidance([guidance], "test guidance"),
    /code does not match engine_ini recipe/,
  );
  delete guidance.code;
  assert.throws(() => normalizeGuidance([guidance], "test guidance"), /code is required/);
});

test("the checked-in ledger covers every active note and excludes unrelated sections", () => {
  const result = verifyCurationLedger(messages, wikiSource);
  assert.equal(result.entries.length, messages.length);
  assert.equal(messages.length, 493);
  assert.deepEqual(result.source.ignored_sections, ["Deprecated", "Related Mods"]);
  assert.equal(result.entries.filter((entry) => entry.disposition === "pending").length, 9);
  assert.equal(result.source.page_reviews.length, 10);
  assert.equal(ledger.entries.length, messages.length);
  assert.equal(JSON.stringify(result).includes("<details>"), false);
});

test("changed upstream note fingerprints cannot silently reach public output", () => {
  const original = wiki.find((game) => game.source_key);
  const message = messages.find(
    (candidate) => candidate.source_key === original.source_key,
  );
  assert.ok(original);
  assert.ok(message);
  assert.throws(
    () =>
      guidanceForWikiGame(original, [
        ...messages.filter((candidate) => candidate.source_key !== message.source_key),
        { ...message, note: `${message.note} changed` },
      ]),
    /fingerprint changed/,
  );
});

test("whole-page changes cannot bypass active-table message review", () => {
  assert.throws(
    () =>
      verifyCurationLedger(messages, {
        ...wikiSource,
        content_sha256: "0".repeat(64),
      }),
    /whole-page fingerprint changed/,
  );
});

test("v2 profiles and title-specific Wukong suppression are materialized", () => {
  assert.deepEqual(
    manifest.engine_profiles.map((profile) => profile.id),
    ["ue_extended", "unreal_legacy", "unity"],
  );
  assert.deepEqual(
    manifest.engine_profiles.map((profile) => profile.processing_path),
    ["native", "unmanaged", "unmanaged"],
  );
  assert.equal(
    manifest.games.some((game) => game.profile_id === "game"),
    false,
  );
  const wukong = manifest.games.find((game) => game.id === "black-myth-wukong");
  assert.ok(wukong);
  assert.equal(wukong.profile_id, "ue_extended");
  assert.equal(wukong.inherit_page_guidance, false);
  assert.deepEqual(
    wukong.guidance.map((item) => item.code),
    ["r.HDR.EnableHDROutput=1"],
  );
  assert.equal(
    wukong.guidance.some((item) => item.id.includes("lut_update")),
    false,
  );
  assert.equal(
    wukong.guidance.some((item) => item.code?.includes("r.AllowHDR")),
    false,
  );

  const ueExtended = manifest.engine_profiles.find(
    (profile) => profile.id === "ue_extended",
  );
  assert.deepEqual(
    ueExtended.guidance
      .filter((item) => item.kind === "engine_ini")
      .map((item) => item.code),
    [
      "[SystemSettings]\nr.AllowHDR=1\nr.HDR.EnableHDROutput=1\nr.HDR.Display.OutputDevice=3\nr.HDR.Display.ColorGamut=2\nr.HDR.UI.CompositeMode=1",
      "[/Script/Engine.RendererSettings]\nr.LUT.UpdateEveryFrame=1",
    ],
  );
  assert.equal(
    ueExtended.guidance.find((item) => item.id.endsWith("lut_update")).condition
      .unreal_minor_min,
    3,
  );
});

test("generated Engine.ini guidance has exactly one manual exception", () => {
  const allGuidance = [
    ...manifest.page_guidance,
    ...manifest.engine_profiles.flatMap((profile) => profile.guidance),
    ...manifest.games.flatMap((game) => game.guidance ?? []),
  ];
  const engineIni = allGuidance.filter((item) => item.kind === "engine_ini");
  const structured = engineIni.filter((item) => item.engine_ini);
  const manual = engineIni.filter((item) => !item.engine_ini);
  assert.equal(engineIni.length, 47);
  assert.equal(structured.length, 46);
  assert.deepEqual(
    manual.map((item) => item.id),
    ["renodx.black_myth_wukong.hdr"],
  );
  assert.deepEqual(
    manual.map((item) => item.code),
    ["r.HDR.EnableHDROutput=1"],
  );
  for (const item of structured) {
    assert.equal(item.code, renderEngineIniRecipe(item.engine_ini), item.id);
  }
});

test("processing policy is the reviewed UE Extended matrix", () => {
  const ueExtended = manifest.games.filter((game) => game.profile_id === "ue_extended");
  assert.equal(ueExtended.length, 60);
  const upgradeIds = [
    "abzu",
    "astroneer",
    "a-way-out",
    "deep-rock-galactic-rogue-core",
    "escape-the-backrooms",
    "frostpunk-2",
    "goat-simulator-3",
    "ghostrunner",
    "hi-fi-rush",
    "hydroneer",
    "the-idolm-ster-starlit-season",
    "it-takes-two",
    "little-nightmares",
    "little-nightmares-enhanced-edition",
    "little-nightmares-ii",
    "motor-town-behind-the-wheel",
    "pacific-drive",
    "persona-3-reload",
    "scorn",
    "sifu",
    "stray",
    "the-alters",
    "vholume",
    "what-remains-of-edith-finch",
  ].sort();
  assert.deepEqual(
    ueExtended
      .filter((game) => game.processing_path === "upgrade")
      .map((game) => game.id)
      .sort(),
    upgradeIds,
  );
  assert.deepEqual(
    ueExtended.filter((game) => game.processing_path === "native").map((game) => game.id),
    ["chromatic-conundrum"],
  );
  assert.equal(
    manifest.games.find((game) => game.id === "black-myth-wukong").processing_path,
    undefined,
    "Wukong inherits the native UE Extended profile without a title override",
  );
  for (const id of [
    "flyknight",
    "ghostrunner-2",
    "palworld",
    "the-first-berserker-khazan",
  ]) {
    const game = manifest.games.find((candidate) => candidate.id === id);
    assert.notEqual(game?.profile_id, "ue_extended");
    assert.equal(game?.processing_path, undefined);
  }
  const settingNames = manifest.games.flatMap((game) =>
    (game.guidance ?? []).flatMap((item) =>
      (item.settings ?? []).map((setting) => setting.name),
    ),
  );
  assert.equal(settingNames.includes("Upgrade Path"), false);
  assert.equal(JSON.stringify(manifest).includes("Set RenoDX Upgrade Path to On"), false);
});

test("resolved legacy and dedicated titles retain manually curated caveats", () => {
  const guidanceText = (id) =>
    (manifest.games.find((game) => game.id === id)?.guidance ?? [])
      .map((item) => item.fallback_text)
      .join("\n");

  assert.match(guidanceText("flyknight"), /in-game filters can alter HDR presentation/i);
  assert.match(guidanceText("flyknight"), /limited testing/i);
  assert.match(guidanceText("flyknight"), /B8G8R8A8_TYPELESS/);
  assert.match(
    guidanceText("ghostrunner-2"),
    /tonemapping issues remain; testing was limited/i,
  );
  assert.match(guidanceText("ghostrunner-2"), /BT\.709/);
  assert.match(guidanceText("palworld"), /limited testing/i);
  assert.match(guidanceText("palworld"), /DLSS because it clamps output to SDR/i);
  assert.match(
    guidanceText("the-first-berserker-khazan"),
    /tonemapping issues remain; testing was limited/i,
  );

  for (const id of [
    "flyknight",
    "ghostrunner-2",
    "palworld",
    "the-first-berserker-khazan",
  ]) {
    const game = manifest.games.find((candidate) => candidate.id === id);
    assert.ok(game);
    assert.notEqual(game.profile_id, "ue_extended");
    assert.equal(game.processing_path, undefined);
    assert.equal(
      (game.guidance ?? []).some((item) =>
        item.settings?.some((setting) => setting.name === "Upgrade Path"),
      ),
      false,
    );
  }

  for (const sourceKey of [
    "ue-extended:flyknight",
    "ue-extended:ghostrunner-2",
    "ue-extended:palworld",
    "ue-extended:the-first-berserker-khazan",
  ]) {
    const entry = ledger.entries.find((candidate) => candidate.source_key === sourceKey);
    assert.equal(entry?.disposition, "omitted");
    assert.match(
      entry?.reason ?? "",
      /moved to resolved (?:legacy|dedicated) title guidance/i,
    );
  }
});

test("exact UE Extended and Unity guidance stays structured", () => {
  const stalker = manifest.games.find(
    (game) => game.id === "s-t-a-l-k-e-r-2-heart-of-chornobyl",
  );
  assert.equal(stalker.profile_id, "ue_extended");
  assert.deepEqual(
    stalker.guidance.flatMap((item) => item.settings ?? []).map((setting) => setting.name),
    ["Gamma", "Contrast", "Brightness", "Native HDR"],
  );

  const unityLaunch = manifest.games.find(
    (game) => game.profile_id === "unity" && game.requirements?.launch?.arguments?.length,
  );
  assert.ok(unityLaunch);
  assert.equal(
    unityLaunch.requirements.launch.arguments.every((argument) => argument.startsWith("-")),
    true,
  );
});

test("public guidance contains no raw wiki markup", () => {
  const guidance = [
    ...manifest.page_guidance,
    ...manifest.engine_profiles.flatMap((profile) => profile.guidance),
    ...manifest.games.flatMap((game) => game.guidance ?? []),
  ];
  for (const item of guidance) {
    assert.equal(
      /<\/?(?:details|summary|br)[^>]*>|\[[^\]]+\]\([^)]*\)|`/.test(item.fallback_text),
      false,
    );
  }
});

test("games do not contain un-unified duplicate settings guidance with identical text", () => {
  for (const game of manifest.games) {
    if (!game.guidance || game.guidance.length <= 1) continue;
    const seen = new Set();
    for (const item of game.guidance) {
      if (
        item.settings &&
        (item.kind === "game_setting" || item.kind === "addon_setting")
      ) {
        const key = `${item.kind}:${item.fallback_text}`;
        assert.equal(
          seen.has(key),
          false,
          `game "${game.id}" contains un-unified ${item.kind} guidance for "${item.fallback_text}"`,
        );
        seen.add(key);
      }
    }
  }
});

test("normalizeGuidance allows different text for multiple game settings", () => {
  assert.doesNotThrow(() =>
    normalizeGuidance(
      [
        {
          id: "hdr",
          kind: "game_setting",
          text: "Enable HDR.",
          settings: [{ name: "HDR", value: "On" }],
        },
        {
          id: "film_grain",
          kind: "game_setting",
          text: "Disable Film Grain.",
          settings: [{ name: "Film Grain", value: "Off" }],
        },
      ],
      "test",
    ),
  );
});

test("normalizeGuidance rejects duplicate game settings with identical text", () => {
  assert.throws(
    () =>
      normalizeGuidance(
        [
          {
            id: "gamma",
            kind: "game_setting",
            text: "Set in-game display settings.",
            settings: [{ name: "Gamma", value: "50%" }],
          },
          {
            id: "contrast",
            kind: "game_setting",
            text: "Set in-game display settings.",
            settings: [{ name: "Contrast", value: "50%" }],
          },
        ],
        "test",
      ),
    /duplicates .* "game_setting" guidance with identical text/,
  );
});

test("S.T.A.L.K.E.R. 2 exposes display settings as one guidance block", () => {
  const game = manifest.games.find(({ id }) => id === "s-t-a-l-k-e-r-2-heart-of-chornobyl");

  assert.ok(game);

  const displayGuidance = game.guidance.filter(
    ({ kind, fallback_text }) =>
      kind === "game_setting" && fallback_text === "Apply these in-game display settings.",
  );

  assert.equal(displayGuidance.length, 1);

  assert.deepEqual(displayGuidance[0].settings, [
    { name: "Gamma", value: "50%" },
    { name: "Contrast", value: "50%" },
    { name: "Brightness", value: "50%" },
  ]);
});

test("normalizeGuidance rejects conflicting id and message_id", () => {
  assert.throws(
    () =>
      normalizeGuidance(
        [
          {
            id: "renodx.foo",
            message_id: "renodx.bar",
            kind: "compatibility",
            text: "Some text.",
          },
        ],
        "test",
      ),
    /id and message_id must match/,
  );
});

test("normalizeGuidance rejects conflicting text and fallback_text", () => {
  assert.throws(
    () =>
      normalizeGuidance(
        [
          {
            id: "example",
            kind: "compatibility",
            text: "One text.",
            fallback_text: "Different text.",
          },
        ],
        "test",
      ),
    /text and fallback_text must match/,
  );
});
