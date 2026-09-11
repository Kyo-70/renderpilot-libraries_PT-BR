import {
  assertNonEmptyArray,
  assertPlainObject,
  requiredNonEmptyString,
} from "../../../../scripts/lib/common.mjs";

export const SCHEMA_VERSION = 1;

const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024;
const MAX_MODULE_ARTIFACT_SIZE = 32 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const STABLE_RELEASE_RE = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const IMMUTABLE_MODULE_TAG_RE = /^v\d+(?:\.\d+)*$/u;
const OFFICIAL_RELEASE_REPOSITORY = "optiscaler/OptiScaler";
const OPTIPATCHER_REPOSITORY = "optiscaler/OptiPatcher";
const OPTIONAL_ARRAY_FIELDS = Object.freeze(["requires", "conflicts"]);

function assertArray(value, context) {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function assertBoundedSize(value, maximum, context) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${context} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function assertSha256(value, context) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new Error(`${context} must be a lowercase SHA-256`);
  }
  return value;
}

function assertStableReleaseId(value, context) {
  if (typeof value !== "string" || !STABLE_RELEASE_RE.test(value)) {
    throw new Error(`${context} must use a stable vX.Y.Z id`);
  }
  return value;
}

function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length !== 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes(":") &&
    !value.includes("\0") &&
    value.split(/[\\/]/u).every((component) => component !== "." && component !== "..")
  );
}

function assertSafeRelativePath(value, context) {
  if (!safeRelativePath(value)) {
    throw new Error(`${context} must be a safe relative path`);
  }
  return value;
}

function safeGitHubSegment(value, maximum) {
  return (
    typeof value === "string" &&
    value.length !== 0 &&
    value.length <= maximum &&
    value !== "." &&
    value !== ".." &&
    !/[\\/\\?#\u0000-\u001F\u007F]/u.test(value)
  );
}

function assertSafeGitHubSegment(value, maximum, context) {
  if (!safeGitHubSegment(value, maximum)) {
    throw new Error(`${context} must be a safe GitHub path segment`);
  }
  return value;
}

function safeIniAtom(value) {
  return (
    typeof value === "string" && value.trim().length !== 0 && !/[\r\n\0\[\]=]/u.test(value)
  );
}

function safeIniValue(value) {
  return typeof value === "string" && !/[\r\n\0]/u.test(value);
}

function assertSafeIniAtom(value, context) {
  if (!safeIniAtom(value)) {
    throw new Error(`${context} must be a safe INI atom`);
  }
  return value;
}

function assertSafeIniValue(value, context) {
  if (!safeIniValue(value)) {
    throw new Error(`${context} must be a safe INI value`);
  }
  return value;
}

function uniqueIndex(items, context) {
  const index = new Map();

  for (const [position, item] of assertArray(items, context).entries()) {
    assertPlainObject(item, `${context}[${position}]`);
    const id = requiredNonEmptyString(item.id, `${context}[${position}].id`);
    const key = id.toLowerCase();
    if (index.has(key)) {
      throw new Error(`${context} has duplicate id ${JSON.stringify(id)}`);
    }
    index.set(key, item);
  }

  return index;
}

function normalizedPath(value) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function assertUniquePath(paths, value, context) {
  const normalized = normalizedPath(assertSafeRelativePath(value, context));
  if (paths.has(normalized)) {
    throw new Error(`${context} collides with another path`);
  }
  paths.add(normalized);
}

function withoutEmptyOptionalArrays(value) {
  const result = structuredClone(value);
  for (const field of OPTIONAL_ARRAY_FIELDS) {
    if (Array.isArray(result[field]) && result[field].length === 0) {
      delete result[field];
    }
  }
  return result;
}

function validateArtifact(module, artifact) {
  const context = `module ${module.id}.artifact`;
  assertPlainObject(artifact, context);
  if (module.id !== "optipatcher") {
    throw new Error(`module ${module.id} has no approved independent artifact source`);
  }
  const id = requiredNonEmptyString(artifact.id, `${context}.id`);
  if (/[\r\n\0]/u.test(id)) {
    throw new Error(`${context}.id contains an unsafe control character`);
  }
  assertSha256(artifact.sha256, `${context}.sha256`);
  assertBoundedSize(artifact.size, MAX_MODULE_ARTIFACT_SIZE, `${context}.size`);
  if (
    artifact.pe_x64 !== true ||
    artifact.target === "$proxy" ||
    !safeRelativePath(artifact.target)
  ) {
    throw new Error(`${context} has an invalid target or architecture`);
  }

  const source = assertPlainObject(artifact.source, `${context}.source`);
  if (
    source.provider !== "github_release" ||
    source.repository !== OPTIPATCHER_REPOSITORY ||
    typeof source.tag !== "string" ||
    !IMMUTABLE_MODULE_TAG_RE.test(source.tag)
  ) {
    throw new Error(`${context} does not use the approved immutable OptiPatcher source`);
  }
  assertSafeGitHubSegment(source.tag, 128, `${context}.source.tag`);
  assertSafeGitHubSegment(source.asset, 255, `${context}.source.asset`);
}

function validateModuleGraph(modules) {
  const modulesById = uniqueIndex(modules, "modules");
  if (!modulesById.has("core")) {
    throw new Error("modules must include core");
  }

  for (const [id, module] of modulesById) {
    const requires = module.requires ?? [];
    const conflicts = module.conflicts ?? [];
    assertArray(requires, `module ${id}.requires`);
    assertArray(conflicts, `module ${id}.conflicts`);

    if (
      new Set(requires).size !== requires.length ||
      new Set(conflicts).size !== conflicts.length
    ) {
      throw new Error(`module ${id} has duplicate relationships`);
    }

    for (const dependency of [...requires, ...conflicts]) {
      if (!modulesById.has(String(dependency).toLowerCase())) {
        throw new Error(`module ${id} references unknown module ${dependency}`);
      }
      if (dependency.toLowerCase() === id) {
        throw new Error(`module ${id} cannot reference itself`);
      }
    }

    for (const dependency of requires) {
      if (conflicts.includes(dependency)) {
        throw new Error(`module ${id} both requires and conflicts with ${dependency}`);
      }
    }

    for (const conflict of conflicts) {
      const peer = modulesById.get(conflict.toLowerCase());
      if (!peer.conflicts?.includes(module.id)) {
        throw new Error(`module conflict ${module.id} <-> ${conflict} must be symmetric`);
      }
    }

    if (module.artifact !== undefined && module.artifact !== null) {
      validateArtifact(module, module.artifact);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail) => {
    if (visiting.has(id)) {
      throw new Error(`module dependency cycle: ${[...trail, id].join(" -> ")}`);
    }
    if (visited.has(id)) return;

    visiting.add(id);
    const module = modulesById.get(id);
    for (const dependency of module.requires ?? []) {
      visit(dependency.toLowerCase(), [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of modulesById.keys()) visit(id, []);
  return modulesById;
}

function validateMigrations(migrations, releases) {
  const schemas = new Set(releases.map((release) => release.config_schema));
  const identities = new Set();

  for (const [index, migration] of assertArray(migrations, "config_migrations").entries()) {
    assertPlainObject(migration, `config_migrations[${index}]`);
    if (migration.from_schema === migration.to_schema) {
      throw new Error(`config_migrations[${index}] must change schema`);
    }
    for (const schema of [migration.from_schema, migration.to_schema]) {
      if (!schemas.has(schema)) {
        throw new Error(`config_migrations[${index}] references unknown schema ${schema}`);
      }
    }
    for (const field of ["from_section", "from_key", "to_section", "to_key"]) {
      assertSafeIniAtom(migration[field], `config_migrations[${index}].${field}`);
    }
    const valueMap = migration.value_map ?? {};
    assertPlainObject(valueMap, `config_migrations[${index}].value_map`);
    for (const [from, to] of Object.entries(valueMap)) {
      if (from === "" || to === "") {
        throw new Error(`config_migrations[${index}] value_map entries must be nonempty`);
      }
      assertSafeIniValue(from, `config_migrations[${index}] value_map source`);
      assertSafeIniValue(to, `config_migrations[${index}] value_map target`);
    }

    const identity = JSON.stringify([
      migration.from_schema,
      migration.to_schema,
      migration.from_section.toLowerCase(),
      migration.from_key.toLowerCase(),
    ]);
    if (identities.has(identity)) {
      throw new Error(`config_migrations[${index}] duplicates a migration source`);
    }
    identities.add(identity);
  }
}

function readMemberCatalog(value) {
  const catalog = assertPlainObject(value, "member_catalog");
  const entries = Object.entries(catalog);
  if (entries.length === 0) {
    throw new Error("member_catalog must not be empty");
  }

  for (const [hash, member] of entries) {
    assertSha256(hash, "member_catalog key");
    assertPlainObject(member, `member_catalog.${hash}`);
  }
  return catalog;
}

function validateReleaseSource(release, releaseSource) {
  assertStableReleaseId(release.id, `release ${release.id}.id`);
  if (
    releaseSource.provider !== "github_release" ||
    releaseSource.repository !== OFFICIAL_RELEASE_REPOSITORY
  ) {
    throw new Error(
      "release_source must name the official OptiScaler GitHub Releases repository",
    );
  }
  assertSafeGitHubSegment(release.asset, 255, `release ${release.id}.asset`);
  if (!release.asset.endsWith(".7z")) {
    throw new Error(`release ${release.id}.asset must be a .7z asset`);
  }
  assertSha256(release.archive_sha256, `release ${release.id}.archive_sha256`);
  assertBoundedSize(
    release.archive_size,
    MAX_ARCHIVE_SIZE,
    `release ${release.id}.archive_size`,
  );
  if (!Number.isSafeInteger(release.config_schema) || release.config_schema <= 0) {
    throw new Error(`release ${release.id}.config_schema must be a positive integer`);
  }
}

function expandRelease(release, releaseSource, memberCatalog, modulesById) {
  assertPlainObject(release, "release");
  validateReleaseSource(release, releaseSource);
  const memberHashes = assertNonEmptyArray(
    release.members,
    `release ${release.id}.members`,
  );
  const seenHashes = new Set();
  const archivePaths = new Set();
  const targetPaths = new Set();
  let proxyCount = 0;
  let configCount = 0;

  const members = memberHashes.map((hash, index) => {
    assertSha256(hash, `release ${release.id}.members[${index}]`);
    if (seenHashes.has(hash)) {
      throw new Error(`release ${release.id} repeats member ${hash}`);
    }
    seenHashes.add(hash);

    const member = memberCatalog[hash];
    if (!member) {
      throw new Error(`release ${release.id} references unknown member ${hash}`);
    }
    const moduleKey = typeof member.module === "string" ? member.module.toLowerCase() : "";
    if (!modulesById.has(moduleKey)) {
      throw new Error(
        `release ${release.id} member ${hash} uses unknown module ${member.module}`,
      );
    }
    assertBoundedSize(member.size, Number.MAX_SAFE_INTEGER, `member ${hash}.size`);
    assertUniquePath(
      archivePaths,
      member.archive_path,
      `release ${release.id} member ${hash}.archive_path`,
    );
    if (member.target === "$proxy") {
      proxyCount += 1;
      if (member.module !== "core") {
        throw new Error(`release ${release.id} proxy member must belong to core`);
      }
    } else {
      assertUniquePath(
        targetPaths,
        member.target,
        `release ${release.id} member ${hash}.target`,
      );
    }
    if (member.target === "OptiScaler.ini") {
      configCount += 1;
      if (member.module !== "core") {
        throw new Error(`release ${release.id} OptiScaler.ini must belong to core`);
      }
    }

    return {
      archive_path: member.archive_path,
      target: member.target,
      sha256: hash,
      size: member.size,
      module: member.module,
      ...(Object.hasOwn(member, "pe_x64") ? { pe_x64: member.pe_x64 } : {}),
    };
  });

  if (proxyCount !== 1) {
    throw new Error(`release ${release.id} must define exactly one proxy member`);
  }
  if (configCount !== 1) {
    throw new Error(`release ${release.id} must define exactly one OptiScaler.ini`);
  }

  for (const module of modulesById.values()) {
    const artifact = module.artifact;
    if (
      artifact &&
      !members.some((member) => member.module === module.id) &&
      targetPaths.has(normalizedPath(artifact.target))
    ) {
      throw new Error(
        `module artifact target ${artifact.target} collides with release ${release.id} layout`,
      );
    }
  }

  return {
    id: release.id,
    source: {
      provider: releaseSource.provider,
      repository: releaseSource.repository,
      tag: release.id,
      asset: release.asset,
    },
    archive_sha256: release.archive_sha256,
    archive_size: release.archive_size,
    config_schema: release.config_schema,
    members,
  };
}

export function buildManifest(source) {
  assertPlainObject(source, "manifest source");
  if (source.schema_version !== SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${SCHEMA_VERSION}`);
  }

  const releaseSource = assertPlainObject(source.release_source, "release_source");
  const memberCatalog = readMemberCatalog(source.member_catalog);
  const modulesById = validateModuleGraph(source.modules);
  const releasesById = uniqueIndex(source.releases, "releases");
  const releases = [...releasesById.values()].map((release) =>
    expandRelease(release, releaseSource, memberCatalog, modulesById),
  );

  if (!releasesById.has(String(source.current_release).toLowerCase())) {
    throw new Error(`current_release references unknown release ${source.current_release}`);
  }

  validateMigrations(source.config_migrations, releases);

  return {
    schema_version: SCHEMA_VERSION,
    revision: source.revision,
    current_release: source.current_release,
    releases,
    modules: source.modules.map(withoutEmptyOptionalArrays),
    config_migrations: structuredClone(source.config_migrations),
  };
}
