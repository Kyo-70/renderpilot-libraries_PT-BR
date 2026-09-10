# RenoDX curation

`wiki_games.json` is the upstream snapshot. `match_overlay.json` contains only
RenoDX policy: availability, variants, source URLs, and an exact
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

`sync:renodx-wiki` writes the wiki snapshot/overlay and regenerates `addons/v1/renodx.json`. The daily `wiki-drift` workflow runs `sync:renodx-wiki --check` and opens/updates GitHub Issue `wiki-drift: renodx` only when the log shows **explicit catalog drift** (not on soft network failures or unclassified crashes). It never writes files. Clear the issue by running `sync:renodx-wiki`, opening a PR, and merging.

The generator emits the canonical `addons/v1/renodx.json` document. Do not invent a parallel root-level compatibility file.

Use structured availability and localized messages in v1. Engine-wide fallbacks belong in `engine_profiles`; concrete games carry only concrete match rules. Explicit source URLs must resolve to the same canonical add-on file name as their slug and architecture.

## Sources of truth

- [Wiki snapshot](wiki_games.json)
- [RenoDX policy overlay](match_overlay.json)
- [Canonical game targets](../../games/match-registry.json)
- [Manifest generator](generate-manifest.mjs)
- [Manifest schema](manifest-v1.schema.json)
- [Wiki drift workflow](../../../.github/workflows/wiki-drift.yml)
