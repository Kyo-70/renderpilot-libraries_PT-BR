#!/usr/bin/env node
// Expand the reviewed, content-addressed OptiScaler source into the flat v1
// manifest consumed by RenderPilot. No binary payload is downloaded or hosted.

import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildManifest } from "./lib/build-manifest.mjs";
import { readJsonFile } from "../../../scripts/lib/json.mjs";
import {
  assertJsonSchema,
  compileJsonSchema,
} from "../../../scripts/lib/json-schema-validation.mjs";
import { runGenerateManifestMain } from "../../../scripts/lib/generate-manifest-runner.mjs";
import { addonCatalogs, repoRoot } from "../../../scripts/catalog.mjs";

const DEFAULT_FILES = Object.freeze({
  source: addonCatalogs.optiscaler.sources.manifestSource,
  outputs: Object.freeze({
    manifest: addonCatalogs.optiscaler.outputs.manifest.file,
  }),
});
const SOURCE_SCHEMA = readJsonFile(
  path.join(repoRoot, "catalogs", "addons", "optiscaler", "manifest-source.schema.json"),
  "OptiScaler manifest source schema",
);
const MANIFEST_SCHEMA = readJsonFile(
  path.join(repoRoot, "catalogs", "addons", "optiscaler", "manifest-v1.schema.json"),
  "OptiScaler manifest v1 schema",
);
const validateSource = compileJsonSchema(SOURCE_SCHEMA);
const validateManifest = compileJsonSchema(MANIFEST_SCHEMA);

const HELP_TEXT = `Usage: node generate-manifest.mjs [--check]

Expand the reviewed OptiScaler source into the flat v1 manifest.

  --check   Do not write files; fail if the generated output differs.
  -h, --help
            Show this help message.`;

/**
 * Builds the generator options used by both the CLI and its no-write boundary
 * test. Validation is intentionally on this reachable generation edge: an
 * invalid authoring document cannot reach the builder, and an invalid public
 * result cannot reach the shared writer.
 */
export function createGenerateManifestOptions(files = DEFAULT_FILES) {
  return {
    files,
    repoRoot,
    helpText: HELP_TEXT,
    preserveGeneratedAt: false,
    readInputs: () => ({
      source: assertJsonSchema(
        readJsonFile(files.source, "manifest-source.json"),
        validateSource,
        "OptiScaler manifest source",
      ),
    }),
    build: ({ source }) => {
      const manifest = assertJsonSchema(
        buildManifest(source),
        validateManifest,
        "generated OptiScaler manifest",
      );
      return {
        outputs: { manifest },
        stats: {
          releases: source.releases.length,
          members: Object.keys(source.member_catalog).length,
        },
      };
    },
    printSummary: ({ releases, members }) => {
      console.log(`manifest: ${releases} releases, ${members} unique members`);
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runGenerateManifestMain(() => createGenerateManifestOptions());
}
