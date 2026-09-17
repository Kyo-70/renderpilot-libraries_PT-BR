# RenoDX curation

`wiki_games.json` is the normalized upstream game snapshot.
`wiki_messages.json` preserves every non-empty active-table message with a stable
`source_key`, while `wiki_source.json` fingerprints the complete current Wiki page.
`review-ledger.json` freezes the reviewed identity, source fingerprint, and explicit
disposition for every active message and every page-level note. `match_overlay.json`
contains only RenoDX policy: availability, variants, source URLs, and exact
`game_target_ids`. The referenced targets in
[`catalogs/games/match-registry.json`](../../games/match-registry.json) owns
every verified store identity and globally unambiguous executable-leaf fact with its
provenance. Rows without a trustworthy target become `pending_match.json`.
Availability/category metadata alone is not a match: assign a reviewed target,
resolve a split to its own target, or set explicit `ignore`.

Run:

```powershell
pnpm run sync:renodx-wiki:check
pnpm run sync:renodx-wiki
pnpm run check:slugs
```

`sync:renodx-wiki` writes the game, message, whole-page source, and overlay snapshots,
then regenerates `addons/v1/renodx.json` and `addons/v2/renodx.json`. Generation
fails until every changed active message has a matching manual decision and the
whole-page fingerprint is accepted after reviewing page-level changes. The daily
`wiki-drift` workflow runs `sync:renodx-wiki --check` and opens/updates GitHub Issue
`wiki-drift: renodx` only when the log shows **explicit catalog drift** (not on soft
network failures or unclassified crashes). It never writes files. Clear the issue
by reviewing the change, updating the snapshots and ledger, opening a PR, and merging.

The generator emits the compatibility-preserving v1 document and the structured v2
document. Do not invent a parallel root-level compatibility file.

V2 owns typed guidance, engine-profile identity, engine-version conditions, and
launch requirements. Guidance is written manually as concise fallback text; raw
Wiki markup is never copied to public output. `Engine.ini` instructions must carry
their exact fragment in `code`, and setting advice uses structured `settings`.
For an automation-eligible Engine.ini instruction, add the closed `engine_ini`
recipe beside the guidance item. It contains a versioned, ordered list of sections
and scalar key/value entries; its `revision` identifies the reviewed semantics of
that recipe. The generator renders the recipe into `code` and rejects any drift.
Consumers must treat `engine_ini` as the execution authority and `code` only as
copyable presentation. Runtime code must never parse the presentation text back
into mutation instructions.

An Engine.ini guidance item without `engine_ini` is intentionally manual-only.
This is the required exception for incomplete or section-ambiguous upstream notes,
such as Black Myth: Wukong: retain its one-line code exactly as reviewed, but do
not invent a section or mark it eligible for automation. Do not add a recipe to
non-`engine_ini` guidance, and do not generalize this contract to arbitrary INI
files.
Reviewed page-wide guidance is composed into installable title/profile guidance.
Use `inherit_page_guidance: false` only for a reviewed exact-title replacement such
as Black Myth: Wukong, whose one-line `Engine.ini` instruction must remain exclusive.

UE Extended is the generic Unreal fallback. The legacy Unreal profile remains
exact-title-only, and a confirmed UE3 runtime must never receive UE Extended.
Unity is a generic profile and may attach curated launch arguments to exact titles.
Deprecated and Related Mods are excluded before runtime reconciliation: do not add
blocks or tombstones for them, because current generic profiles should continue to
resolve normally.

Each active message must be explicitly `curated_manual`, `pending`, or `omitted`
with a reason. Never infer guidance from regexes or broad heuristics. Pending is for
genuinely incomplete upstream instructions and does not enter public guidance.

## Sources of truth

- [Wiki snapshot](wiki_games.json)
- [Active Wiki messages](wiki_messages.json)
- [Whole-page Wiki fingerprint](wiki_source.json)
- [Manual review ledger](review-ledger.json)
- [RenoDX policy overlay](match_overlay.json)
- [Canonical game targets](../../games/match-registry.json)
- [Manifest generator](generate-manifest.mjs)
- [Manifest schema](manifest-v1.schema.json)
- [Manifest v2 schema](manifest-v2.schema.json)
- [Wiki drift workflow](../../../.github/workflows/wiki-drift.yml)
