import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenerateManifestOptions } from "../generate-manifest.mjs";
import { runGenerateManifest } from "../../../../scripts/lib/generate-manifest-runner.mjs";
import { fixtureSource } from "./helpers.mjs";

test("OptiScaler generator validates authoring input before it can write output", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "renderpilot-optiscaler-generator-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));

  const source = fixtureSource();
  source.releases[0].archive_size = 128 * 1024 * 1024 + 1;
  const sourceFile = path.join(directory, "manifest-source.json");
  const manifestFile = path.join(directory, "optiscaler.json");
  await writeFile(sourceFile, `${JSON.stringify(source)}\n`);

  await assert.rejects(
    () =>
      runGenerateManifest(
        createGenerateManifestOptions({
          source: sourceFile,
          outputs: { manifest: manifestFile },
        }),
      ),
    /OptiScaler manifest source failed JSON Schema validation/u,
  );
  assert.equal(existsSync(manifestFile), false, "invalid source must not create output");
});
