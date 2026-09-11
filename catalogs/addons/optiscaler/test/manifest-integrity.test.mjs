import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { buildManifest } from "../lib/build-manifest.mjs";
import { MANIFEST_FILE, SOURCE_FILE, readJson } from "./helpers.mjs";

const IMMUTABLE_RELEASES = Object.freeze({
  "v0.9.0": {
    archiveSize: 53353132,
    archiveHash: "a988ce2c0a86bba58a6313659d1ed2ab78f994dbdfab246394a2e4293ac68010",
    proxyHash: "64b818976dadcae26caa8a80f2ec023c15a0e1b59100fc806740c9ddfbefcbd7",
    recordHash: "83782c931938183c8473a4d26d715a845ed4fe7188e170c92394ce4f60c18fd8",
  },
  "v0.9.1": {
    archiveSize: 53342538,
    archiveHash: "56d1a18e3a32d978c0134844e803ba8cf04134226cfcdb8283f68d180836fab0",
    proxyHash: "7d225b8d4d882b1d91e3a17e93b017c038b126462ff00fac0baf788f046822a8",
    recordHash: "484a3db36fb05e12d4410fc67204775f3207c3dba2a4a9aa9296ef59177d5e69",
  },
  "v0.9.2": {
    archiveSize: 53388454,
    archiveHash: "6426a16085f6128c810e0de58947029664439afd0567b6a286c0e3ef784a92a1",
    proxyHash: "62022e09a6679b12485da569f857220132155bfd2375fe01b4f232e306a76da6",
    recordHash: "2bdbd437309d1ba778956596225273be58a90ec15117f5cf8b6b4e5af9473847",
  },
  "v0.9.3": {
    archiveSize: 53356866,
    archiveHash: "e3ac655d60ec11b471ac8cc5f4d3758e4bce9151c86caa339d8f0700c00282e3",
    proxyHash: "2369120927264bb2b120e7fb0940cb0b3242dc788417ab92fb99953555016511",
    recordHash: "4415ff41c0099056ad7a72a91cc681a2a39be7148fdce7d3f1f17a459069a71c",
  },
  "v0.9.4": {
    archiveSize: 55016448,
    archiveHash: "575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad",
    proxyHash: "fbfb6676b829dad7e020fb830586a16aa0ec6add78016db48ef12e2ae1803231",
    recordHash: "c2b36142af2764d6472018b1e246c614a21b879aabf06a766724cde4301f3892",
  },
});

test("committed OptiScaler manifest is the deterministic source projection", async () => {
  const [source, manifest] = await Promise.all([
    readJson(SOURCE_FILE),
    readJson(MANIFEST_FILE),
  ]);

  assert.deepEqual(manifest, buildManifest(source));
  assert.equal(Object.keys(source.member_catalog).length, 27);

  const referencedMembers = new Set(source.releases.flatMap((release) => release.members));
  assert.deepEqual(
    [...referencedMembers].sort(),
    Object.keys(source.member_catalog).sort(),
    "member_catalog must not contain orphaned member definitions",
  );
  assert.equal(Object.hasOwn(manifest, "member_catalog"), false);
  assert.equal(Object.hasOwn(manifest, "release_source"), false);
});

test("every committed stable release retains its immutable byte identity", async () => {
  const manifest = await readJson(MANIFEST_FILE);
  const releases = new Map(manifest.releases.map((release) => [release.id, release]));

  assert.deepEqual([...releases.keys()], Object.keys(IMMUTABLE_RELEASES));
  assert.ok(releases.has(manifest.current_release), "current_release must exist");

  for (const [id, identity] of Object.entries(IMMUTABLE_RELEASES)) {
    const release = releases.get(id);
    const proxy = release.members.filter((member) => member.target === "$proxy");
    const config = release.members.filter((member) => member.target === "OptiScaler.ini");

    assert.equal(release.source.provider, "github_release");
    assert.equal(release.source.repository, "optiscaler/OptiScaler");
    assert.equal(release.source.tag, id);
    assert.equal(release.archive_size, identity.archiveSize);
    assert.equal(release.archive_sha256, identity.archiveHash);
    assert.equal(
      createHash("sha256").update(JSON.stringify(release)).digest("hex"),
      identity.recordHash,
      `${id} immutable release record changed`,
    );
    assert.equal(proxy.length, 1, `${id} must contain exactly one proxy`);
    assert.equal(proxy[0].module, "core");
    assert.equal(proxy[0].sha256, identity.proxyHash);
    assert.equal(config.length, 1, `${id} must contain exactly one OptiScaler.ini`);
    assert.equal(config[0].module, "core");
    assert.equal(Object.hasOwn(release, "ignored_members"), false);
  }
});

test("module policy retains its reviewed identity", async () => {
  const manifest = await readJson(MANIFEST_FILE);
  const modules = new Map(manifest.modules.map((module) => [module.id, module]));

  assert.equal(modules.size, manifest.modules.length, "module ids must be unique");
  assert.ok(modules.has("core"));
  assert.ok(modules.has("nvidia_sr"));
  assert.equal(modules.has("metadata"), false);
  for (const module of modules.values()) {
    assert.equal(Object.hasOwn(module, "releases"), false);
  }

  const patcher = modules.get("optipatcher");
  assert.deepEqual(patcher.artifact, {
    id: "v0.41",
    source: {
      provider: "github_release",
      repository: "optiscaler/OptiPatcher",
      tag: "v0.41",
      asset: "OptiPatcher_v0.41.asi",
    },
    sha256: "fb12735bfcc0d47f534f2206d57ec34129dc3d22b6405a1c2ef86745ab48b2eb",
    size: 95232,
    target: "plugins/OptiPatcher.asi",
    pe_x64: true,
  });

  assert.equal(Object.hasOwn(manifest, "compatibility"), false);
  assert.equal(Object.hasOwn(manifest, "wiki_revision"), false);
});

test("OptiScaler metadata never embeds binary transport URLs", async () => {
  const manifest = await readJson(MANIFEST_FILE);
  const serialized = JSON.stringify(manifest).toLowerCase();

  for (const forbidden of ["archive_url", "cdn.cloudflare", "r2.dev", "https://"]) {
    assert.equal(serialized.includes(forbidden), false, `manifest contains ${forbidden}`);
  }
});
