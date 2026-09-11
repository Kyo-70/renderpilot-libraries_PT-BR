#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildCompatibilityCatalog } from "./compatibility/lib/build-catalog.mjs";
import { readJsonFile } from "../../../scripts/lib/json.mjs";
import {
  assertJsonSchema,
  compileJsonSchema,
} from "../../../scripts/lib/json-schema-validation.mjs";
import { runGenerateManifestMain } from "../../../scripts/lib/generate-manifest-runner.mjs";
import { addonCatalogs, repoRoot } from "../../../scripts/catalog.mjs";
import { createMatchRegistry } from "../../../scripts/lib/match-registry.mjs";

const directory = path.join(repoRoot, "catalogs", "addons", "optiscaler", "compatibility");
const schemas = Object.freeze({
  snapshot: compileJsonSchema(
    readJsonFile(path.join(directory, "upstream-snapshot.schema.json")),
  ),
  ledger: compileJsonSchema(
    readJsonFile(path.join(directory, "review-ledger.schema.json")),
  ),
  curated: compileJsonSchema(readJsonFile(path.join(directory, "authoring.schema.json"))),
  messages: compileJsonSchema(
    readJsonFile(path.join(directory, "messages-source.schema.json")),
  ),
  catalog: compileJsonSchema(readJsonFile(path.join(directory, "runtime-v1.schema.json"))),
  messageContract: compileJsonSchema(
    readJsonFile(path.join(directory, "messages-v1.schema.json")),
  ),
});

const DEFAULT_FILES = Object.freeze({
  snapshot: addonCatalogs.optiscaler.sources.compatibilitySnapshot,
  ledger: addonCatalogs.optiscaler.sources.compatibilityLedger,
  curated: addonCatalogs.optiscaler.sources.compatibilityCurated,
  messages: addonCatalogs.optiscaler.sources.compatibilityMessages,
  releaseSource: addonCatalogs.optiscaler.sources.manifestSource,
  matchRegistry: addonCatalogs.optiscaler.sources.matchRegistry,
  outputs: {
    manifest: addonCatalogs.optiscaler.outputs.compatibility.file,
    messages: addonCatalogs.optiscaler.outputs.compatibilityMessages.file,
  },
});

const HELP_TEXT = `Usage: node generate-compatibility.mjs [--check]

Generate the independent OptiScaler v1 compatibility and message contracts.

  --check   Do not write files; fail if generated outputs differ.
  -h, --help
            Show this help message.`;

function schemaInput(file, validate, name) {
  return assertJsonSchema(readJsonFile(file, name), validate, name);
}

export function createGenerateCompatibilityOptions(files = DEFAULT_FILES) {
  return {
    files,
    repoRoot,
    helpText: HELP_TEXT,
    preserveGeneratedAt: false,
    readInputs: () => ({
      snapshot: schemaInput(
        files.snapshot,
        schemas.snapshot,
        "OptiScaler compatibility snapshot",
      ),
      ledger: schemaInput(files.ledger, schemas.ledger, "OptiScaler compatibility ledger"),
      curatedGames: schemaInput(
        files.curated,
        schemas.curated,
        "OptiScaler compatibility authoring",
      ),
      messages: schemaInput(
        files.messages,
        schemas.messages,
        "OptiScaler compatibility messages",
      ),
      releaseSource: readJsonFile(files.releaseSource, "OptiScaler release source"),
      registry: createMatchRegistry(
        readJsonFile(files.matchRegistry, "match-registry.json"),
      ),
    }),
    build: (inputs) => {
      const result = buildCompatibilityCatalog(inputs);
      return {
        outputs: {
          manifest: assertJsonSchema(
            result.catalog,
            schemas.catalog,
            "OptiScaler compatibility catalog",
          ),
          messages: assertJsonSchema(
            result.messageContract,
            schemas.messageContract,
            "OptiScaler compatibility message contract",
          ),
        },
        stats: result.stats,
      };
    },
    printSummary: ({ entries, messages }) => {
      console.log(
        `compatibility: ${entries} published entries, ${messages} localized messages`,
      );
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGenerateManifestMain(() => createGenerateCompatibilityOptions());
}
