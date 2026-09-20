import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { normalizeEngineIniRecipe, renderEngineIniRecipe } from "../../engine-ini.mjs";

const curatedGames = JSON.parse(
  readFileSync(new URL("../curated_games.json", import.meta.url), "utf8"),
);
const lumaV2 = JSON.parse(
  readFileSync(new URL("../../../../addons/v2/luma.json", import.meta.url)),
);
const lumaV2Schema = JSON.parse(
  readFileSync(new URL("../manifest-v2.schema.json", import.meta.url)),
);
const validateLumaV2 = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(lumaV2Schema);
})();

test("all curated Luma Engine.ini recipes render their published code canonically", () => {
  const recipes = curatedGames.flatMap((game) =>
    (game.guidance ?? [])
      .filter((guidance) => guidance.kind === "engine_ini")
      .map((guidance) => ({ game, guidance })),
  );

  assert.equal(recipes.length, 25);
  for (const { game, guidance } of recipes) {
    const { id: _sourceId, ...recipe } = guidance.engine_ini;
    assert.equal(
      guidance.code,
      renderEngineIniRecipe(normalizeEngineIniRecipe(recipe)),
      `${game.id}/${guidance.id} must keep code synchronized with its typed recipe`,
    );
  }
});

test("generated Luma v1 strips typed recipes while v2 preserves them", () => {
  const v1 = JSON.parse(
    readFileSync(new URL("../../../../addons/v1/luma.json", import.meta.url)),
  );
  const v2 = JSON.parse(
    readFileSync(new URL("../../../../addons/v2/luma.json", import.meta.url)),
  );

  assert.equal(v1.schema_version, 1);
  assert.equal(v2.schema_version, 2);

  const v1EngineIni = v1.games.flatMap((game) =>
    (game.guidance ?? []).filter((guidance) => guidance.kind === "engine_ini"),
  );
  const v2EngineIni = v2.games.flatMap((game) =>
    (game.guidance ?? []).filter((guidance) => guidance.kind === "engine_ini"),
  );

  assert.equal(v1EngineIni.length, 25);
  assert.equal(v2EngineIni.length, 25);
  assert.equal(
    v1.games.some((game) =>
      (game.guidance ?? []).some((guidance) => "engine_ini" in guidance),
    ),
    false,
  );
  assert.ok(v2EngineIni.every((guidance) => guidance.engine_ini?.schema_version === 1));
});

test("v2 schema requires typed Engine.ini guidance and forbids code fields elsewhere", () => {
  assert.equal(validateLumaV2(lumaV2), true, JSON.stringify(validateLumaV2.errors));

  const engineGame = lumaV2.games.find((game) =>
    game.guidance?.some((guidance) => guidance.kind === "engine_ini"),
  );
  assert.ok(engineGame, "generated v2 must contain an Engine.ini guidance item");
  const engineGuidance = engineGame.guidance.find(
    (guidance) => guidance.kind === "engine_ini",
  );

  const withoutRecipe = structuredClone(lumaV2);
  const withoutRecipeGuidance = withoutRecipe.games
    .find((game) => game.id === engineGame.id)
    .guidance.find((guidance) => guidance.id === engineGuidance.id);
  delete withoutRecipeGuidance.engine_ini;
  assert.equal(validateLumaV2(withoutRecipe), false);

  const warningWithCode = structuredClone(lumaV2);
  const warningGuidance = warningWithCode.games
    .find((game) => game.id === engineGame.id)
    .guidance.find((guidance) => guidance.id === engineGuidance.id);
  warningGuidance.kind = "warning";
  delete warningGuidance.engine_ini;
  assert.equal(validateLumaV2(warningWithCode), false);

  const warningWithRecipe = structuredClone(lumaV2);
  const recipeGuidance = warningWithRecipe.games
    .find((game) => game.id === engineGame.id)
    .guidance.find((guidance) => guidance.id === engineGuidance.id);
  recipeGuidance.kind = "warning";
  delete recipeGuidance.code;
  assert.equal(validateLumaV2(warningWithRecipe), false);
});
