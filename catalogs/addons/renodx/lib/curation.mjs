import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { reviewedDecision, reviewedSourceKeys } from "./reviewed-guidance.mjs";

const LEDGER_FILE = new URL("../review-ledger.json", import.meta.url);
const LEDGER = JSON.parse(readFileSync(LEDGER_FILE, "utf8"));
const ENTRIES = new Map(LEDGER.entries.map((entry) => [entry.source_key, entry]));

export const CURATION_POLICY_VERSION = LEDGER.policy_version;
export const PAGE_GUIDANCE = Object.freeze(LEDGER.source.page_guidance ?? []);

function fingerprint(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message) {
  throw new Error(`RenoDX curation ledger: ${message}`);
}

function verifyEntry(message) {
  if (!message?.note) return null;
  const entry = ENTRIES.get(message.source_key);
  if (!entry) fail(`active note ${message.source_key} has no reviewed disposition`);
  const actual = fingerprint(message.note);
  if (entry.note_sha256 !== actual) {
    fail(
      `note fingerprint changed for ${message.source_key}; review the upstream message before generation`,
    );
  }
  if (
    entry.game_id !== message.game_id ||
    entry.title !== message.title ||
    entry.section !== message.section ||
    entry.profile_source !== message.profile_source
  ) {
    fail(`identity changed for ${message.source_key}; update the reviewed ledger entry`);
  }
  const decision = reviewedDecision(message.source_key);
  if (!decision) fail(`active note ${message.source_key} has no human-authored decision`);
  if (
    entry.disposition !== decision.disposition ||
    entry.reason !== (decision.reason ?? null)
  ) {
    fail(
      `ledger disposition changed for ${message.source_key}; regenerate it only after review`,
    );
  }
  return entry;
}

function materializeDecision(message) {
  verifyEntry(message);
  const decision = reviewedDecision(message.source_key);
  const idBase = `renodx.${message.source_key.replace(/[^a-z0-9]+/g, ".")}`;
  return {
    ...decision,
    processing_path: decision.processing_path ?? null,
    guidance: decision.guidance.map((item, index) => ({
      id: `${idBase}.${index + 1}`,
      message_id: `${idBase}.${index + 1}`,
      ...item,
    })),
  };
}

/** Returns only the frozen, human-authored payload for one active wiki note. */
export function guidanceForWikiGame(game, wikiMessages) {
  return decisionForWikiGame(game, wikiMessages)?.guidance ?? [];
}

export function decisionForWikiGame(game, wikiMessages) {
  const primary = game?.source_key;
  const additionals = game?.additional_source_keys ?? [];
  const sourceKeys = primary ? [primary, ...additionals] : additionals;
  if (sourceKeys.length === 0) return null;
  const parts = sourceKeys.map((sourceKey) => {
    const message = wikiMessages.find((candidate) => candidate.source_key === sourceKey);
    if (!message)
      fail(`selected source ${sourceKey} is missing from the wiki message snapshot`);
    return materializeDecision(message);
  });
  return clone({
    guidance: parts.flatMap((part) =>
      part.disposition === "pending" || part.disposition === "omitted" ? [] : part.guidance,
    ),
    inherit_common: parts.some((part) => part.inherit_common),
    launch: parts.find((part) => part.launch)?.launch ?? null,
    processing_path: parts.find((part) => part.processing_path)?.processing_path ?? null,
  });
}

/**
 * Verifies complete active-note coverage and returns the checked-in ledger.
 * New, removed, or changed active notes intentionally fail generation until a
 * maintainer makes an explicit disposition in review-ledger.json.
 */
export function verifyCurationLedger(wikiMessages, wikiSource) {
  if (wikiSource?.url !== LEDGER.source.wiki) {
    fail("wiki source URL changed; review the new authority before generation");
  }
  if (wikiSource?.content_sha256 !== LEDGER.source.wiki_content_sha256) {
    fail(
      "whole-page fingerprint changed; review every changed page message before generation",
    );
  }
  const reviewedKeys = reviewedSourceKeys();
  const activeKeys = new Set(wikiMessages.map((message) => message.source_key));
  for (const message of wikiMessages) verifyEntry(message);
  for (const entry of LEDGER.entries) {
    if (!activeKeys.has(entry.source_key)) {
      fail(`ledger entry ${entry.source_key} no longer matches an active note`);
    }
  }
  for (const sourceKey of reviewedKeys) {
    if (!activeKeys.has(sourceKey))
      fail(`review decision ${sourceKey} no longer matches an active note`);
  }
  const actualFingerprint = fingerprint(
    wikiMessages
      .map((message) => `${message.source_key}:${fingerprint(message.note)}`)
      .join("\n"),
  );
  if (actualFingerprint !== LEDGER.source.active_message_fingerprint) {
    fail(
      `active-message fingerprint changed (${actualFingerprint}); update the reviewed ledger after manual review`,
    );
  }
  return clone(LEDGER);
}
