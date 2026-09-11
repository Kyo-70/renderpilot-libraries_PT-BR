import { sha256Hex } from "../../../../../scripts/lib/hash.mjs";
import {
  extractMarkdownLinkLabel,
  splitMarkdownTableRow,
} from "../../../../../scripts/lib/wiki-markdown.mjs";

const SOURCE = "optiscaler-wiki-compatibility-list";

function normalizeHeader(value) {
  return String(value)
    .replace(/<br\s*\/?\s*>/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function normalizeWikiText(value) {
  return String(value)
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/[*_]+/gu, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function wikiFingerprint(value) {
  return sha256Hex(Buffer.from(String(value), "utf8"));
}

function statusFromCell(value) {
  const normalized = String(value);
  if (normalized.includes("✅") || normalized.includes(":white_check_mark:")) {
    return "working";
  }
  if (normalized.includes("❌") || normalized.includes(":x:")) return "unsupported";
  if (normalized.includes("➖") || normalized.includes(":heavy_minus_sign:")) {
    return "conditional";
  }
  throw new Error(`unrecognized OptiScaler compatibility status ${JSON.stringify(value)}`);
}

function declaredInputs(value) {
  const normalized = String(value).toLowerCase();
  const inputs = [];
  if (normalized.includes("dlss")) inputs.push("dlss2_plus");
  if (normalized.includes("fsr")) inputs.push("fsr2_plus");
  if (normalized.includes("xess")) inputs.push("xess");
  return inputs;
}

function isCompatibilityTable(headers) {
  return (
    headers.includes("game") &&
    headers.includes("compatibility") &&
    headers.some((header) => header.includes("upscaler") && header.includes("inputs"))
  );
}

function column(headers, predicate, context) {
  const index = headers.findIndex(predicate);
  if (index < 0) throw new Error(`OptiScaler wiki ${context} column is missing`);
  return index;
}

function rowFromCells({ cells, section, ordinal, columns }) {
  const title = normalizeWikiText(extractMarkdownLinkLabel(cells[columns.gameIndex] ?? ""));
  if (!title) throw new Error(`OptiScaler wiki ${section} row ${ordinal + 1} has no title`);

  // Wiki notes sometimes contain an unescaped pipe. The final images column
  // is not semantic input, so rejoin every middle cell deterministically.
  const noteCells = cells.slice(columns.notesIndex, -1);
  const note = normalizeWikiText(noteCells.join("|"));
  const rawInputs = normalizeWikiText(cells[columns.inputsIndex] ?? "");
  const optipatcher =
    columns.patcherIndex < 0 ? "" : normalizeWikiText(cells[columns.patcherIndex] ?? "");
  const row = {
    source_key: `${section}:${String(ordinal + 1).padStart(4, "0")}`,
    section,
    title,
    status: statusFromCell(cells[columns.statusIndex] ?? ""),
    declared_inputs: declaredInputs(rawInputs),
    optipatcher_supported: /✨|supported/iu.test(optipatcher),
    note: note || null,
  };
  return {
    ...row,
    row_fingerprint: wikiFingerprint(JSON.stringify(row)),
    ...(note ? { note_fingerprint: wikiFingerprint(note) } : {}),
  };
}

/** Parses only the two documented compatibility tables, never their prose. */
export function parseOptiScalerWiki(markdown) {
  const rows = [];
  const seenTitles = new Map();
  let section = "main";
  let columns = null;
  let ordinal = 0;

  for (const rawLine of String(markdown).split(/\r\n?|\n/gu)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.*)$/u)?.[1]?.toLowerCase();
    if (heading) {
      section = heading.includes("luma unreal") ? "luma_unreal" : "main";
      columns = null;
      ordinal = 0;
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = splitMarkdownTableRow(line);
    const headers = cells.map(normalizeHeader);
    if (isCompatibilityTable(headers)) {
      columns = {
        gameIndex: column(headers, (header) => header === "game", "game"),
        statusIndex: column(
          headers,
          (header) => header === "compatibility",
          "compatibility",
        ),
        inputsIndex: column(
          headers,
          (header) => header.includes("upscaler") && header.includes("inputs"),
          "upscaler inputs",
        ),
        notesIndex: column(headers, (header) => header === "notes", "notes"),
        patcherIndex: headers.findIndex((header) => header.includes("optipatcher")),
      };
      ordinal = 0;
      continue;
    }
    if (!columns || /^:?-{3,}:?$/u.test(cells[0] ?? "")) continue;
    try {
      statusFromCell(cells[columns.statusIndex] ?? "");
    } catch {
      continue;
    }
    const row = rowFromCells({ cells, section, ordinal, columns });
    ordinal += 1;
    const titleKey = `${section}:${row.title.toLocaleLowerCase("en-US")}`;
    const duplicate_of = seenTitles.get(titleKey) ?? null;
    seenTitles.set(titleKey, row.source_key);
    if (duplicate_of) {
      const duplicate = { ...row, duplicate_of };
      rows.push({
        ...duplicate,
        row_fingerprint: wikiFingerprint(JSON.stringify(duplicate)),
      });
    } else {
      rows.push(row);
    }
  }

  if (rows.length === 0) throw new Error("OptiScaler wiki has no compatibility rows");
  return rows;
}

export function buildUpstreamSnapshot({ markdown, snapshotRevision }) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(snapshotRevision)) {
    throw new Error("snapshotRevision must use YYYY-MM-DD");
  }
  const rows = parseOptiScalerWiki(markdown);
  return {
    schema_version: 1,
    source: SOURCE,
    snapshot_revision: snapshotRevision,
    snapshot_sha256: wikiFingerprint(markdown),
    rows,
  };
}

export { SOURCE as OPTISCALER_WIKI_SOURCE };
