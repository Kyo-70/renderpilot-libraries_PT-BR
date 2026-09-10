#!/usr/bin/env node
// Generate the RenoDX v1 manifest (`addons/v1/renodx.json`).
//
// The app fetches RenoDX add-ons live from upstream, so this manifest carries no
// artifacts or hashes. The authoring inputs stay in this folder; the served
// document is written under addons/v1/.

import { buildManifest } from "./lib/build-manifest.mjs";
import { readJsonFile } from "../../../scripts/lib/json.mjs";
import { runGenerateManifestMain } from "../../../scripts/lib/generate-manifest-runner.mjs";
import { addonCatalogs, repoRoot } from "../../../scripts/catalog.mjs";
import { createMatchRegistry } from "../../../scripts/lib/match-registry.mjs";

const FILES = Object.freeze({
  wiki: addonCatalogs.renodx.sources.wiki,
  curatedGames: addonCatalogs.renodx.sources.curatedGames,
  overlay: addonCatalogs.renodx.sources.overlay,
  matchRegistry: addonCatalogs.renodx.sources.matchRegistry,
  outputs: {
    manifest: addonCatalogs.renodx.outputs.manifest.file,
    pending: addonCatalogs.renodx.sources.pending,
  },
});

const HELP_TEXT = `Usage: node generate-manifest.mjs [--check]

Generate the v1 RenoDX document from the curation inputs and neutral match registry.

  --check   Do not write files; fail if the generated output differs.
  -h, --help
            Show this help message.`;

runGenerateManifestMain(() => ({
  files: FILES,
  repoRoot,
  helpText: HELP_TEXT,
  build: (inputs) => {
    const result = buildManifest(inputs);
    return {
      outputs: {
        manifest: result.manifest,
        pending: result.pending,
      },
      stats: result.stats,
    };
  },
  readInputs: ({ generatedAt }) => ({
    wiki: readJsonFile(FILES.wiki, "wiki_games.json"),
    curatedGames: readJsonFile(FILES.curatedGames, "curated_games.json"),
    overlay: readJsonFile(FILES.overlay, "match_overlay.json"),
    registry: createMatchRegistry(readJsonFile(FILES.matchRegistry, "match-registry.json")),
    generatedAt,
  }),
  printSummary: (stats) => {
    console.log(
      `manifest: ${stats.games} games (${stats.external} external, ` +
        `${stats.native_hdr} native-hdr, ${stats.blocked} blocked), ` +
        `${stats.engineProfiles} engine profiles`,
    );

    console.log(`pending (no AppID/exe yet): ${stats.pending} -> pending_match.json`);
  },
}));
