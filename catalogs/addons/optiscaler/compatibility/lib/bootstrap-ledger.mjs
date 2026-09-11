/**
 * Creates the deliberately conservative initial ledger. It publishes nothing:
 * an exact runtime identity and explicit policy review are both required before
 * a row can move from pending_identity to published.
 */
export function createInitialLedger(snapshot) {
  return {
    schema_version: 1,
    snapshot_sha256: snapshot.snapshot_sha256,
    rows: snapshot.rows.map((row) => ({
      source_key: row.source_key,
      row_fingerprint: row.row_fingerprint,
      disposition: {
        kind: "pending_identity",
        reason: "An exact runtime identity has not been curated.",
      },
      notes: row.note
        ? [
            {
              fingerprint: row.note_fingerprint,
              disposition: {
                kind: "omitted",
                reason:
                  "The note is withheld until its game identity and policy are reviewed.",
              },
            },
          ]
        : [],
    })),
  };
}
