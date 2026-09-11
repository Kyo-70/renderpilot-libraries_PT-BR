import fs from "node:fs/promises";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const SOURCE_FILE = path.join(
  REPO_ROOT,
  "catalogs",
  "addons",
  "optiscaler",
  "manifest-source.json",
);
export const SOURCE_SCHEMA_FILE = path.join(
  REPO_ROOT,
  "catalogs",
  "addons",
  "optiscaler",
  "manifest-source.schema.json",
);
export const MANIFEST_FILE = path.join(REPO_ROOT, "addons", "v1", "optiscaler.json");
export const MANIFEST_SCHEMA_FILE = path.join(
  REPO_ROOT,
  "catalogs",
  "addons",
  "optiscaler",
  "manifest-v1.schema.json",
);

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function fixtureSource() {
  const proxyHash = "1".repeat(64);
  const configHash = "2".repeat(64);

  return {
    schema_version: 1,
    revision: "2026-07-25.1",
    current_release: "v1.0.0",
    release_source: {
      provider: "github_release",
      repository: "optiscaler/OptiScaler",
    },
    member_catalog: {
      [proxyHash]: {
        archive_path: "OptiScaler.dll",
        target: "$proxy",
        size: 100,
        module: "core",
        pe_x64: true,
      },
      [configHash]: {
        archive_path: "OptiScaler.ini",
        target: "OptiScaler.ini",
        size: 50,
        module: "core",
      },
    },
    releases: [
      {
        id: "v1.0.0",
        asset: "OptiScaler_1.0.0.7z",
        archive_sha256: "3".repeat(64),
        archive_size: 1000,
        config_schema: 1,
        members: [proxyHash, configHash],
      },
    ],
    modules: [
      {
        id: "core",
        optional: false,
        bundled_by_default: true,
        description: "Core files",
      },
    ],
    config_migrations: [],
  };
}
