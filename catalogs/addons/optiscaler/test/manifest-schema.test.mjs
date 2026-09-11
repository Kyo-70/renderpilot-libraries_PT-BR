import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";

import {
  MANIFEST_FILE,
  MANIFEST_SCHEMA_FILE,
  SOURCE_FILE,
  SOURCE_SCHEMA_FILE,
  readJson,
} from "./helpers.mjs";

async function compile(schemaFile) {
  const schema = await readJson(schemaFile);
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

test("OptiScaler authoring source and public manifest satisfy their schemas", async () => {
  const [source, manifest, validateSource, validateManifest] = await Promise.all([
    readJson(SOURCE_FILE),
    readJson(MANIFEST_FILE),
    compile(SOURCE_SCHEMA_FILE),
    compile(MANIFEST_SCHEMA_FILE),
  ]);

  assert.equal(validateSource(source), true, JSON.stringify(validateSource.errors));
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
});

test("authoring schema rejects malformed content-addressed members", async () => {
  const [source, validate] = await Promise.all([
    readJson(SOURCE_FILE),
    compile(SOURCE_SCHEMA_FILE),
  ]);
  const [hash, member] = Object.entries(source.member_catalog)[0];

  delete source.member_catalog[hash];
  source.member_catalog.invalid = member;
  assert.equal(validate(source), false, "member keys must be lowercase SHA-256 values");

  delete source.member_catalog.invalid;
  source.member_catalog[hash] = { ...member, target: "../OptiScaler.dll" };
  assert.equal(validate(source), false, "member targets must be safe relative paths");
});

test("public schema rejects obsolete release and compatibility fields", async () => {
  const [manifest, validate] = await Promise.all([
    readJson(MANIFEST_FILE),
    compile(MANIFEST_SCHEMA_FILE),
  ]);

  manifest.releases[0].channel = "stable";
  assert.equal(validate(manifest), false, "obsolete release channels must be rejected");
  delete manifest.releases[0].channel;

  manifest.compatibility = [];
  assert.equal(
    validate(manifest),
    false,
    "release manifest must not carry compatibility policy",
  );
});

test("OptiScaler schemas reject bounded and unsafe scalar values", async () => {
  const [source, manifest, validateSource, validateManifest] = await Promise.all([
    readJson(SOURCE_FILE),
    readJson(MANIFEST_FILE),
    compile(SOURCE_SCHEMA_FILE),
    compile(MANIFEST_SCHEMA_FILE),
  ]);
  const cases = [
    {
      name: "archives above the consumer limit",
      mutateSource(value) {
        value.releases[0].archive_size = 128 * 1024 * 1024 + 1;
      },
      mutateManifest(value) {
        value.releases[0].archive_size = 128 * 1024 * 1024 + 1;
      },
    },
    {
      name: "module artifacts above the consumer limit",
      mutateSource(value) {
        value.modules.find((module) => module.id === "optipatcher").artifact.size =
          32 * 1024 * 1024 + 1;
      },
      mutateManifest(value) {
        value.modules.find((module) => module.id === "optipatcher").artifact.size =
          32 * 1024 * 1024 + 1;
      },
    },
    {
      name: "rooted member paths",
      mutateSource(value) {
        const hash = value.releases[0].members[0];
        value.member_catalog[hash].archive_path = "\\\\server\\payload.dll";
      },
      mutateManifest(value) {
        value.releases[0].members[0].archive_path = "\\\\server\\payload.dll";
      },
    },
    {
      name: "drive-qualified member targets",
      mutateSource(value) {
        const hash = value.releases[0].members[1];
        value.member_catalog[hash].target = "C:\\OptiScaler.ini";
      },
      mutateManifest(value) {
        value.releases[0].members[1].target = "C:\\OptiScaler.ini";
      },
    },
    {
      name: "dot-segment archive paths",
      mutateSource(value) {
        const hash = value.releases[0].members[1];
        value.member_catalog[hash].archive_path = "payload/../OptiScaler.ini";
      },
      mutateManifest(value) {
        value.releases[0].members[1].archive_path = "payload/../OptiScaler.ini";
      },
    },
    {
      name: "reserved proxy artifact targets",
      mutateSource(value) {
        value.modules.find((module) => module.id === "optipatcher").artifact.target =
          "$proxy";
      },
      mutateManifest(value) {
        value.modules.find((module) => module.id === "optipatcher").artifact.target =
          "$proxy";
      },
    },
    {
      name: "unsafe module asset names",
      mutateSource(value) {
        value.modules.find((module) => module.id === "optipatcher").artifact.source.asset =
          "nested/OptiPatcher.asi";
      },
      mutateManifest(value) {
        value.modules.find((module) => module.id === "optipatcher").artifact.source.asset =
          "nested/OptiPatcher.asi";
      },
    },
  ];

  for (const { name, mutateSource, mutateManifest } of cases) {
    const invalidSource = structuredClone(source);
    const invalidManifest = structuredClone(manifest);
    mutateSource(invalidSource);
    mutateManifest(invalidManifest);
    assert.equal(validateSource(invalidSource), false, `source accepted ${name}`);
    assert.equal(validateManifest(invalidManifest), false, `manifest accepted ${name}`);
  }
});
