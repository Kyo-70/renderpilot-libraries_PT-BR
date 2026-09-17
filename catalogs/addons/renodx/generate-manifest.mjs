#!/usr/bin/env node
// Generate the RenoDX v1 manifest (`addons/v1/renodx.json`).
//
// The app fetches RenoDX add-ons live from upstream, so this manifest carries no
// artifacts or hashes. The authoring inputs stay in this folder; the served
// document is written under addons/v1/.

import { buildManifest } from "./lib/build-manifest.mjs";
import { buildV2Artifacts } from "./lib/build-v2.mjs";
import { readJsonFile } from "../../../scripts/lib/json.mjs";
import { runGenerateManifestMain } from "../../../scripts/lib/generate-manifest-runner.mjs";
import { addonCatalogs, repoRoot } from "../../../scripts/catalog.mjs";
import { createMatchRegistry } from "../../../scripts/lib/match-registry.mjs";

const FILES = Object.freeze({
  wiki: addonCatalogs.renodx.sources.wiki,
  wikiMessages: addonCatalogs.renodx.sources.wikiMessages,
  wikiSource: addonCatalogs.renodx.sources.wikiSource,
  curatedGames: addonCatalogs.renodx.sources.curatedGames,
  messages: addonCatalogs.renodx.sources.messages,
  overlay: addonCatalogs.renodx.sources.overlay,
  matchRegistry: addonCatalogs.renodx.sources.matchRegistry,
  outputs: {
    manifest: addonCatalogs.renodx.outputs.manifest.file,
    manifestV2: addonCatalogs.renodx.outputs.manifestV2.file,
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
    const v2 = buildV2Artifacts(result.manifest, {
      generatedAt: result.manifest.generated_at,
      wikiGames: inputs.wiki,
      wikiMessages: inputs.wikiMessages,
      wikiSource: inputs.wikiSource,
      messages: inputs.messages,
    });
    return {
      outputs: {
        manifest: result.manifest,
        manifestV2: v2.manifest,
        pending: result.pending,
      },
      stats: result.stats,
    };
  },
  readInputs: ({ generatedAt }) => ({
    wiki: readJsonFile(FILES.wiki, "wiki_games.json"),
    wikiMessages: readJsonFile(FILES.wikiMessages, "wiki_messages.json"),
    wikiSource: readJsonFile(FILES.wikiSource, "wiki_source.json"),
    curatedGames: readJsonFile(FILES.curatedGames, "curated_games.json"),
    messages: readJsonFile(FILES.messages, "messages.json"),
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
