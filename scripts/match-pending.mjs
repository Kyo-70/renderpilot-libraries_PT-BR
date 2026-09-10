#!/usr/bin/env node

import { addonCatalogs } from "./catalog.mjs";
import { UsageError } from "./lib/common.mjs";
import { parseCliArgs, wantsHelp } from "./lib/cli-args.mjs";
import { runCliMain } from "./lib/cli-main.mjs";
import { runPendingMatching } from "./lib/pending-matching.mjs";
import {
  createLumaPendingStore,
  createRenodxPendingStore,
} from "./lib/pending-match-stores.mjs";

const DEFAULT_TOOL = "renodx";
const TOOLS = Object.freeze({
  renodx: Object.freeze({
    catalog: addonCatalogs.renodx,
    createStore: createRenodxPendingStore,
  }),
  luma: Object.freeze({
    catalog: addonCatalogs.luma,
    createStore: createLumaPendingStore,
  }),
});

const HELP_TEXT = `Usage: node scripts/match-pending.mjs [--tool=renodx|luma] [--target-id=<pending-id>=<target-id>]

Match pending Steam AppIDs for an add-on catalogue and write explicit registry references.

  --tool=renodx|luma
                        Catalogue to process (default: renodx).
  --target-id=<pending-id>=<target-id>
                        Required for a pending profile without exactly one
                        existing target reference. Repeat per pending profile.
  -h, --help           Show this help message.`;

export function parseToolArg(argv) {
  if (wantsHelp(argv)) {
    return { help: true, tool: DEFAULT_TOOL, targetIdsByGame: new Map() };
  }

  const { values } = parseCliArgs(argv, {
    tool: { type: "string", default: DEFAULT_TOOL },
    "target-id": { type: "string", multiple: true },
    help: { type: "boolean", short: "h" },
  });

  const tool = String(values.tool ?? DEFAULT_TOOL);
  if (!Object.hasOwn(TOOLS, tool)) {
    throw new UsageError(
      `Unknown --tool "${tool}"; expected one of: ${Object.keys(TOOLS).join(", ")}`,
    );
  }
  return {
    help: false,
    tool,
    targetIdsByGame: parseTargetIds(values["target-id"] ?? []),
  };
}

function parseTargetIds(values) {
  const targetIdsByGame = new Map();
  for (const value of values) {
    const [rawGameId, rawTargetId, ...remainder] = String(value).split("=");
    const gameId = rawGameId?.trim();
    const targetId = rawTargetId?.trim();
    if (!gameId || !targetId || remainder.length > 0) {
      throw new UsageError(
        `Invalid --target-id=${value}; expected <pending-id>=<target-id>.`,
      );
    }
    if (targetIdsByGame.has(gameId)) {
      throw new UsageError(`Duplicate --target-id for pending id ${gameId}.`);
    }
    targetIdsByGame.set(gameId, targetId);
  }
  return targetIdsByGame;
}

export function filesForTool(tool) {
  const catalog = TOOLS[tool]?.catalog;
  if (!catalog) throw new UsageError(`Unknown tool: ${tool}`);

  return {
    pendingMatch: catalog.sources.pending ?? null,
    matchOverlay: catalog.sources.overlay ?? null,
    profiles: catalog.sources.curatedGames ?? null,
    matchRegistry: catalog.sources.matchRegistry,
    unmatched: catalog.sources.unmatched,
    manifest: catalog.outputs.manifest.file,
  };
}

function printHelp() {
  console.error(HELP_TEXT);
}

async function main({ tool, targetIdsByGame }) {
  await runPendingMatching({
    tool,
    files: filesForTool(tool),
    createStore: TOOLS[tool].createStore,
    targetIdsByGame,
    loadPendingGames: TOOLS[tool].loadPendingGames,
  });
}

if (import.meta.main) {
  runCliMain({
    parse: parseToolArg,
    help: printHelp,
    main,
  });
}
