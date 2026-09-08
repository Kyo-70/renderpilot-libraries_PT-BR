import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { repoRoot, resolveRepoPath } from "../lib/repo-paths.mjs";
import {
  repoRoot as catalogRepoRoot,
  resolveRepoPath as catalogResolveRepoPath,
} from "../catalog.mjs";

test("repoRoot points to the repository root containing package.json", () => {
  assert.ok(repoRoot, "repoRoot must be defined");
  assert.ok(
    existsSync(path.join(repoRoot, "package.json")),
    "package.json must exist in repoRoot",
  );
});

test("resolveRepoPath resolves relative paths against repoRoot", () => {
  assert.equal(resolveRepoPath(), repoRoot);
  assert.equal(resolveRepoPath("package.json"), path.join(repoRoot, "package.json"));
  assert.equal(
    resolveRepoPath("scripts", "lib", "repo-paths.mjs"),
    path.join(repoRoot, "scripts", "lib", "repo-paths.mjs"),
  );
});

test("catalog.mjs re-exports identical repoRoot and resolveRepoPath", () => {
  assert.equal(catalogRepoRoot, repoRoot);
  assert.equal(catalogResolveRepoPath("package.json"), resolveRepoPath("package.json"));
});
