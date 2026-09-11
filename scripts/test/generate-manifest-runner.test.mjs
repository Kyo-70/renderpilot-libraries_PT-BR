import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runGenerateManifest } from "../lib/generate-manifest-runner.mjs";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "renderpilot-generate-"));

  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("runGenerateManifest writes and checks a single generated manifest output", async () => {
  await withTempDir(async (repoRoot) => {
    const files = {
      outputs: {
        manifest: path.join(repoRoot, "reshade.json"),
      },
    };

    const options = {
      files,
      repoRoot,
      helpText: "help",
      build: ({ generatedAt }) => ({
        outputs: {
          manifest: {
            schema_version: 1,
            generated_at: generatedAt,
          },
        },
      }),
      readInputs: ({ generatedAt }) => ({ generatedAt }),
    };

    assert.equal(await runGenerateManifest(options), 0);
    assert.equal(await runGenerateManifest({ ...options, argv: ["--check"] }), 0);
  });
});

test("runGenerateManifest supports reviewed manifests without generated_at", async () => {
  await withTempDir(async (repoRoot) => {
    const files = {
      outputs: {
        manifest: path.join(repoRoot, "reviewed.json"),
      },
    };

    const options = {
      files,
      repoRoot,
      helpText: "help",
      preserveGeneratedAt: false,
      build: ({ source }) => ({ outputs: { manifest: source } }),
      readInputs: ({ generatedAt }) => {
        assert.equal(generatedAt, undefined);
        return { source: { schema_version: 1, revision: "reviewed" } };
      },
    };

    assert.equal(await runGenerateManifest(options), 0);
    assert.equal(await runGenerateManifest({ ...options, argv: ["--check"] }), 0);
  });
});

test("runGenerateManifest writes and checks manifest plus pending outputs", async () => {
  await withTempDir(async (repoRoot) => {
    const files = {
      outputs: {
        manifest: path.join(repoRoot, "tool_manifest.json"),
        pending: path.join(repoRoot, "tool_pending.json"),
      },
    };

    const options = {
      files,
      repoRoot,
      helpText: "help",
      build: ({ generatedAt }) => ({
        outputs: {
          manifest: {
            schema_version: 1,
            generated_at: generatedAt,
            source: "explicit-authoring",
          },
          pending: [{ id: "needs-match" }],
        },
      }),
      readInputs: ({ generatedAt }) => ({ generatedAt }),
    };

    assert.equal(await runGenerateManifest(options), 0);
    assert.equal(await runGenerateManifest({ ...options, argv: ["--check"] }), 0);
  });
});

test("runGenerateManifest writes and checks primary plus secondary outputs", async () => {
  await withTempDir(async (repoRoot) => {
    const files = {
      outputs: {
        manifest: path.join(repoRoot, "tool.json"),
        secondary: path.join(repoRoot, "tool_secondary.json"),
      },
    };

    const options = {
      files,
      repoRoot,
      helpText: "help",
      build: ({ generatedAt }) => ({
        outputs: {
          manifest: { schema_version: 1, generated_at: generatedAt, games: [] },
          secondary: { schema_version: 1, generated_at: generatedAt, items: [] },
        },
      }),
      readInputs: ({ generatedAt }) => ({ generatedAt }),
    };

    assert.equal(await runGenerateManifest(options), 0);
    assert.equal(await runGenerateManifest({ ...options, argv: ["--check"] }), 0);
  });
});

test("runGenerateManifest requires files.outputs.manifest", async () => {
  await withTempDir(async (repoRoot) => {
    await assert.rejects(
      () =>
        runGenerateManifest({
          files: { outputs: {} },
          repoRoot,
          helpText: "help",
          build: () => ({ outputs: {} }),
          readInputs: () => ({}),
        }),
      /files\.outputs\.manifest is required/,
    );
  });
});
