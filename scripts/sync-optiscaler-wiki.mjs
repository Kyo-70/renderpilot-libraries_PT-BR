#!/usr/bin/env node

import { addonCatalogs } from "./catalog.mjs";
import { runCliMain } from "./lib/cli-main.mjs";
import { parseCliArgs, wantsHelp } from "./lib/cli-args.mjs";
import { readJsonFile, writeFormattedJsonFile } from "./lib/json.mjs";
import { fetchWikiMarkdown } from "./lib/wiki-sync.mjs";
import { buildUpstreamSnapshot } from "../catalogs/addons/optiscaler/compatibility/lib/parse-wiki.mjs";
import { createInitialLedger } from "../catalogs/addons/optiscaler/compatibility/lib/bootstrap-ledger.mjs";
import { auditCompatibilityReview } from "../catalogs/addons/optiscaler/compatibility/lib/reconcile-wiki.mjs";

const WIKI_URL =
  "https://raw.githubusercontent.com/wiki/optiscaler/OptiScaler/Compatibility-List.md";
const OPTIONS = Object.freeze({
  check: { type: "boolean" },
  "bootstrap-ledger": { type: "boolean" },
  help: { type: "boolean", short: "h" },
});

function parse(args) {
  if (wantsHelp(args)) return { help: true, check: false, bootstrapLedger: false };
  const { values } = parseCliArgs(args, OPTIONS);
  return {
    help: false,
    check: Boolean(values.check),
    bootstrapLedger: Boolean(values["bootstrap-ledger"]),
  };
}

function usage() {
  console.error(
    "Usage: node scripts/sync-optiscaler-wiki.mjs [--check | --bootstrap-ledger]",
  );
  console.error("");
  console.error("Fetch the OptiScaler Compatibility List into the audited snapshot.");
  console.error(
    "--check verifies live upstream, the snapshot, and every review disposition.",
  );
  console.error(
    "--bootstrap-ledger creates a conservative pending-identity ledger for a new snapshot.",
  );
}

function snapshotRevision(markdown) {
  const match = markdown.match(/Last updated\s*[–-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/iu);
  if (!match)
    throw new Error("OptiScaler wiki does not declare a usable Last updated date");
  const parsed = Date.parse(`${match[2]} ${match[1]}, ${match[3]} UTC`);
  if (!Number.isFinite(parsed))
    throw new Error("OptiScaler wiki Last updated date is invalid");
  return new Date(parsed).toISOString().slice(0, 10);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function main(args) {
  console.log("Fetching OptiScaler Compatibility List...");
  const markdown = await fetchWikiMarkdown(WIKI_URL);
  const snapshot = buildUpstreamSnapshot({
    markdown,
    snapshotRevision: snapshotRevision(markdown),
  });
  const files = addonCatalogs.optiscaler.sources;
  const snapshotFile = files.compatibilitySnapshot;
  const ledgerFile = files.compatibilityLedger;

  if (args.bootstrapLedger) {
    if (args.check)
      throw new Error("--check and --bootstrap-ledger cannot be used together");
    await writeFormattedJsonFile(snapshotFile, snapshot);
    await writeFormattedJsonFile(ledgerFile, createInitialLedger(snapshot));
    console.log(
      `Wrote ${snapshot.rows.length} upstream rows and a conservative review ledger.`,
    );
    return;
  }

  const checkedIn = readJsonFile(snapshotFile, "OptiScaler compatibility snapshot");
  if (!sameJson(checkedIn, snapshot)) {
    if (args.check) {
      throw new Error(
        "OptiScaler compatibility wiki drift detected; refresh snapshot and review every affected ledger entry",
      );
    }
    await writeFormattedJsonFile(snapshotFile, snapshot);
    throw new Error(
      "Upstream snapshot updated; review ledger is now intentionally stale and must be reconciled before publishing",
    );
  }

  const ledger = readJsonFile(ledgerFile, "OptiScaler compatibility ledger");
  const curatedGames = readJsonFile(
    files.compatibilityCurated,
    "OptiScaler compatibility authoring",
  );
  auditCompatibilityReview({ snapshot, ledger, curatedGames });
  console.log(
    `No upstream drift: ${snapshot.rows.length} rows have complete review dispositions.`,
  );
}

runCliMain({ parse, help: usage, main });
