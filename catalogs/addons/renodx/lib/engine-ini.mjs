// Typed Engine.ini authoring for RenoDX v2.
//
// A recipe is the execution contract.  Its generated `code` representation is
// deliberately derived from the recipe so presentation and future mutation
// code cannot silently diverge.

export {
  defineEngineIniRecipe,
  normalizeEngineIniRecipe,
  renderEngineIniRecipe,
} from "../../engine-ini.mjs";
import { defineEngineIniRecipe, renderEngineIniRecipe } from "../../engine-ini.mjs";

export const UE_HDR_ENGINE_INI_RECIPE = defineEngineIniRecipe({
  schema_version: 1,
  revision: 1,
  sections: [
    {
      name: "SystemSettings",
      entries: [
        { key: "r.AllowHDR", value: "1" },
        { key: "r.HDR.EnableHDROutput", value: "1" },
        { key: "r.HDR.Display.OutputDevice", value: "3" },
        { key: "r.HDR.Display.ColorGamut", value: "2" },
        { key: "r.HDR.UI.CompositeMode", value: "1" },
      ],
    },
  ],
});

export const UE_LUT_ENGINE_INI_RECIPE = defineEngineIniRecipe({
  schema_version: 1,
  revision: 1,
  sections: [
    {
      name: "/Script/Engine.RendererSettings",
      entries: [{ key: "r.LUT.UpdateEveryFrame", value: "1" }],
    },
  ],
});

/** Creates a reviewed Engine.ini guidance item with canonical presentation code. */
export function engineIniGuidance(text, recipe, condition) {
  const normalized = defineEngineIniRecipe(recipe);
  return {
    kind: "engine_ini",
    fallback_text: text,
    engine_ini: normalized,
    code: renderEngineIniRecipe(normalized),
    ...(condition ? { condition } : {}),
  };
}
