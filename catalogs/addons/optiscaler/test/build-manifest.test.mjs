import test from "node:test";
import assert from "node:assert/strict";

import { buildManifest } from "../lib/build-manifest.mjs";
import { fixtureSource } from "./helpers.mjs";

test("buildManifest expands content-addressed members into a flat v1 release", () => {
  const source = fixtureSource();
  source.modules[0].requires = [];
  const manifest = buildManifest(source);
  const hashes = source.releases[0].members;

  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.releases[0].source.tag, "v1.0.0");
  assert.deepEqual(
    manifest.releases[0].members.map((member) => member.sha256),
    hashes,
  );
  assert.equal(manifest.releases[0].members[0].target, "$proxy");
  assert.equal(Object.hasOwn(manifest, "release_source"), false);
  assert.equal(Object.hasOwn(manifest, "member_catalog"), false);
  assert.equal(Object.hasOwn(manifest.modules[0], "requires"), false);
  assert.equal(Object.hasOwn(manifest, "compatibility"), false);
  assert.equal(Object.hasOwn(manifest, "wiki_revision"), false);
});

test("buildManifest rejects unknown and repeated member references", () => {
  const unknown = fixtureSource();
  unknown.releases[0].members[0] = "f".repeat(64);
  assert.throws(() => buildManifest(unknown), /references unknown member/u);

  const repeated = fixtureSource();
  repeated.releases[0].members.push(repeated.releases[0].members[0]);
  assert.throws(() => buildManifest(repeated), /repeats member/u);
});

test("buildManifest rejects duplicate release ids", () => {
  const duplicateRelease = fixtureSource();
  duplicateRelease.releases.push(structuredClone(duplicateRelease.releases[0]));
  assert.throws(() => buildManifest(duplicateRelease), /releases has duplicate id/u);
});

test("buildManifest rejects case-insensitive archive and target collisions", () => {
  const archiveCollision = fixtureSource();
  const configHash = archiveCollision.releases[0].members[1];
  archiveCollision.member_catalog[configHash].archive_path = "OPTISCALER.DLL";
  assert.throws(() => buildManifest(archiveCollision), /archive_path collides/u);

  const targetCollision = fixtureSource();
  const extraHash = "4".repeat(64);
  targetCollision.member_catalog[extraHash] = {
    archive_path: "nested/config.ini",
    target: "optiscaler.INI",
    size: 25,
    module: "core",
  };
  targetCollision.releases[0].members.push(extraHash);
  assert.throws(() => buildManifest(targetCollision), /target collides/u);
});

test("buildManifest rejects invalid module relationships", () => {
  const unknown = fixtureSource();
  unknown.modules.push({
    id: "optional",
    optional: true,
    bundled_by_default: false,
    requires: ["missing"],
    description: "Optional module",
  });
  assert.throws(() => buildManifest(unknown), /references unknown module missing/u);

  const cycle = fixtureSource();
  cycle.modules[0].requires = ["optional"];
  cycle.modules.push({
    id: "optional",
    optional: true,
    bundled_by_default: false,
    requires: ["core"],
    description: "Optional module",
  });
  assert.throws(() => buildManifest(cycle), /module dependency cycle/u);
});

test("buildManifest validates current release and migrations", () => {
  const current = fixtureSource();
  current.current_release = "v2.0.0";
  assert.throws(() => buildManifest(current), /current_release references unknown/u);

  const migration = fixtureSource();
  migration.config_migrations.push({
    from_schema: 1,
    to_schema: 2,
    from_section: "Old",
    from_key: "Key",
    to_section: "New",
    to_key: "Key",
  });
  assert.throws(() => buildManifest(migration), /references unknown schema 2/u);
});

test("buildManifest rejects the semantic shapes the consumer fails closed", () => {
  const cases = [
    {
      name: "asymmetric module conflicts",
      arrange(source) {
        source.modules[0].conflicts = ["optional"];
        source.modules.push({
          id: "optional",
          optional: true,
          bundled_by_default: false,
          description: "Optional module",
        });
      },
      expected: /must be symmetric/u,
    },
    {
      name: "unapproved mutable module artifact",
      arrange(source) {
        source.modules.push({
          id: "optipatcher",
          optional: true,
          bundled_by_default: false,
          description: "Independent module",
          artifact: {
            id: "rolling",
            source: {
              provider: "github_release",
              repository: "optiscaler/OptiPatcher",
              tag: "rolling",
              asset: "OptiPatcher.asi",
            },
            sha256: "4".repeat(64),
            size: 1,
            target: "plugins/OptiPatcher.asi",
            pe_x64: true,
          },
        });
      },
      expected: /approved immutable OptiPatcher source/u,
    },
    {
      name: "unsafe migration values",
      arrange(source) {
        source.releases.push({
          ...structuredClone(source.releases[0]),
          id: "v1.0.1",
          asset: "OptiScaler_1.0.1.7z",
          config_schema: 2,
        });
        source.config_migrations.push({
          from_schema: 1,
          to_schema: 2,
          from_section: "Old",
          from_key: "Key",
          to_section: "New",
          to_key: "Key",
          value_map: { valid: "not\nvalid" },
        });
      },
      expected: /safe INI value/u,
    },
    {
      name: "artifact collision with an absent release module",
      arrange(source) {
        source.modules.push({
          id: "optipatcher",
          optional: true,
          bundled_by_default: false,
          description: "Independent module",
          artifact: {
            id: "v1",
            source: {
              provider: "github_release",
              repository: "optiscaler/OptiPatcher",
              tag: "v1",
              asset: "OptiPatcher_v1.asi",
            },
            sha256: "4".repeat(64),
            size: 1,
            target: "OptiScaler.ini",
            pe_x64: true,
          },
        });
      },
      expected: /collides with release/u,
    },
  ];

  for (const { name, arrange, expected } of cases) {
    const source = fixtureSource();
    arrange(source);
    assert.throws(() => buildManifest(source), expected, name);
  }
});
