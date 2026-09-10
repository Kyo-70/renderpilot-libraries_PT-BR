// Shared executable-basename validation and unknown-field warnings for add-on
// authoring. Canonical game match facts belong only to match-registry.json.

import { requiredNonEmptyString } from "./common.mjs";

const APPID_RE = /^[1-9]\d*$/u;
const EXE_EXTENSION_RE = /\.exe$/iu;
const WINDOWS_BASENAME_FORBIDDEN_RE = /[<>:"/\\|?*\u0000-\u001F]/u;

// Add-on policy documents must reference a neutral game target rather than
// carry direct matching facts. `exe_*` reserves every executable-derived form
// for the registry rather than enumerating historical spellings here.
const DIRECT_GAME_MATCH_FIELDS = new Set(["match", "appid", "appids", "exe"]);

export function directGameMatchField(value) {
  return (
    Object.keys(value).find(
      (field) => DIRECT_GAME_MATCH_FIELDS.has(field) || field.startsWith("exe_"),
    ) ?? null
  );
}

function validateWarningSink(warn) {
  if (typeof warn !== "function") {
    throw new Error("warn must be a function");
  }
}

export function warnUnknownFields(value, knownFields, context, warn = console.warn) {
  validateWarningSink(warn);

  for (const key of Object.keys(value)) {
    if (!knownFields.has(key)) {
      warn(`Warning: ${context} has unknown field "${key}" (typo? ignored)`);
    }
  }
}

export function normalizeAppid(value, context) {
  const appid =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : null;

  if (!appid || !APPID_RE.test(appid)) {
    throw new Error(`${context} must be a positive Steam AppID`);
  }

  return appid;
}

export function normalizeExeName(value, context) {
  if (value === null || value === undefined) {
    return null;
  }

  const exe = requiredNonEmptyString(value, context);

  if (
    exe === ".exe" ||
    !EXE_EXTENSION_RE.test(exe) ||
    WINDOWS_BASENAME_FORBIDDEN_RE.test(exe)
  ) {
    throw new Error(`${context} must be an .exe basename`);
  }

  return exe;
}
