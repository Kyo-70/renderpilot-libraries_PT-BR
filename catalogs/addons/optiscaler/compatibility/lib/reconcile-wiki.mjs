import {
  assertPlainObject,
  requiredNonEmptyString,
} from "../../../../../scripts/lib/common.mjs";

const ROW_DISPOSITIONS = new Set(["published", "pending_identity", "omitted"]);
const NOTE_DISPOSITIONS = new Set(["typed_policy", "guidance", "omitted"]);

function indexBy(items, key, context) {
  if (!Array.isArray(items)) throw new Error(`${context} must be an array`);
  const index = new Map();
  for (const [position, item] of items.entries()) {
    assertPlainObject(item, `${context}[${position}]`);
    const value = requiredNonEmptyString(item[key], `${context}[${position}].${key}`);
    if (index.has(value)) throw new Error(`${context} has duplicate ${key} ${value}`);
    index.set(value, item);
  }
  return index;
}

function assertReason(disposition, context) {
  requiredNonEmptyString(disposition.reason, `${context}.reason`);
}

/**
 * Validates the review ledger as a total, fingerprint-bound mapping over the
 * checked-in upstream snapshot. This is intentionally strict: a source row
 * cannot silently disappear, move, or change its note without a new review.
 */
export function auditCompatibilityReview({ snapshot, ledger, curatedGames }) {
  assertPlainObject(snapshot, "upstream-snapshot.json");
  assertPlainObject(ledger, "review-ledger.json");
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : null;
  if (!rows || rows.length === 0) throw new Error("upstream snapshot has no rows");
  if (ledger.snapshot_sha256 !== snapshot.snapshot_sha256) {
    throw new Error("review ledger is bound to a different upstream snapshot");
  }

  const ledgerRows = indexBy(ledger.rows, "source_key", "review-ledger.rows");
  const curated = indexBy(curatedGames.entries, "id", "curated-games.entries");
  const published = new Set();
  const guidanceMessageIds = new Set();

  for (const row of rows) {
    const review = ledgerRows.get(row.source_key);
    if (!review) throw new Error(`review ledger is missing row ${row.source_key}`);
    if (review.row_fingerprint !== row.row_fingerprint) {
      throw new Error(`review ledger row fingerprint changed for ${row.source_key}`);
    }
    assertPlainObject(review.disposition, `review ledger disposition ${row.source_key}`);
    const kind = review.disposition.kind;
    if (!ROW_DISPOSITIONS.has(kind)) {
      throw new Error(`review ledger row ${row.source_key} has invalid disposition`);
    }
    if (row.duplicate_of && kind !== "omitted") {
      throw new Error(
        `duplicate upstream row ${row.source_key} must be explicitly omitted`,
      );
    }
    if (kind === "published") {
      const entryId = requiredNonEmptyString(
        review.disposition.entry_id,
        `review ledger row ${row.source_key}.entry_id`,
      );
      const entry = curated.get(entryId);
      if (!entry || entry.source_ref !== row.source_key) {
        throw new Error(`published row ${row.source_key} has no exact curated entry`);
      }
      published.add(entryId);
    } else {
      assertReason(review.disposition, `review ledger row ${row.source_key}`);
      if (Object.hasOwn(review.disposition, "entry_id")) {
        throw new Error(`non-published row ${row.source_key} must not name an entry`);
      }
    }

    const noteReviews = indexBy(
      review.notes ?? [],
      "fingerprint",
      `review ledger notes ${row.source_key}`,
    );
    if (row.note) {
      const noteReview = noteReviews.get(row.note_fingerprint);
      if (!noteReview) throw new Error(`review ledger is missing note ${row.source_key}`);
      assertPlainObject(noteReview.disposition, `review ledger note ${row.source_key}`);
      const noteKind = noteReview.disposition.kind;
      if (!NOTE_DISPOSITIONS.has(noteKind)) {
        throw new Error(`review ledger note ${row.source_key} has invalid disposition`);
      }
      if (noteKind === "guidance" || noteKind === "typed_policy") {
        const messageIds = noteReview.disposition.message_ids;
        if (noteKind === "typed_policy") {
          assertReason(noteReview.disposition, `review ledger note ${row.source_key}`);
        }
        if (messageIds !== undefined) {
          if (!Array.isArray(messageIds) || messageIds.length === 0) {
            throw new Error(
              `review ledger note ${row.source_key}.message_ids must not be empty`,
            );
          }
          for (const messageId of messageIds) {
            const id = requiredNonEmptyString(
              messageId,
              `review ledger note ${row.source_key}.message_ids`,
            );
            if (guidanceMessageIds.has(id)) {
              throw new Error(
                `review ledger guidance message ${id} is bound more than once`,
              );
            }
            guidanceMessageIds.add(id);
          }
        } else if (noteKind === "guidance") {
          throw new Error(
            `review ledger note ${row.source_key}.message_ids must not be empty`,
          );
        }
      } else {
        assertReason(noteReview.disposition, `review ledger note ${row.source_key}`);
      }
    }
    if (noteReviews.size !== (row.note ? 1 : 0)) {
      throw new Error(
        `review ledger has stale or duplicate note review for ${row.source_key}`,
      );
    }
  }

  if (ledgerRows.size !== rows.length) {
    throw new Error("review ledger has a removed or duplicate upstream row");
  }
  for (const entry of curated.values()) {
    if (!published.has(entry.id)) {
      throw new Error(`curated entry ${entry.id} is not published by the review ledger`);
    }
  }
  return { publishedEntryIds: published, guidanceMessageIds };
}
