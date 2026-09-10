# Luma curation

`curated_games.json` is the Luma policy catalog. It holds profiles,
requirements, features, reviewed guidance, the upstream note-review audit, and
one or more exact `game_target_ids` where a shared profile is installable. Verified install
identities and their provenance are owned once by
[`catalogs/games/match-registry.json`](../../games/match-registry.json), not by
Luma. Omit `profile` for a game-specific payload; set it explicitly to
`"unreal"` or `"unity"` for an engine profile. The obsolete `generic` flag is
rejected.

Only reviewed `guidance` reaches the public v1 manifest. Unmatched records are written to `pending_match.json` and are not published as installable. Set `match_ignore: true` on a profile to permanently skip Steam matching (for example after a duplicate AppID); ignored profiles are neither pending nor published.

Run:

```powershell
pnpm run sync:luma-wiki:check
pnpm run sync:luma-wiki
pnpm run check:luma-assets
pnpm run check:luma-payload-layout
```

`sync:luma-wiki` updates curated status/features from the wiki (never raw notes) and regenerates `addons/v1/luma.json`. The daily `wiki-drift` workflow runs `sync:luma-wiki --check` and opens/updates GitHub Issue `wiki-drift: luma` only when the log shows **explicit catalog drift** (not on soft network failures or unclassified crashes). It never writes files. Clear the issue by reviewing notes if needed, running `sync:luma-wiki`, opening a PR, and merging.

The generated contract is `addons/v1/luma.json`. `minimum_reshade_version` is the host compatibility floor, `package` identifies the exact release asset and root add-on, and public `profile` is the strict `"game" | "unreal" | "unity"` enum. Unreal requires `Luma-Unreal_Engine.zip` plus `features`; Unity requires the exact architecture-specific shared asset and forbids `features`; game profiles forbid all shared engine assets and `features`.

Guidance must have a stable `id`, reviewed English fallback, allowed kind, and exact code only for INI or launch-argument instructions.

Do not publish raw Wiki notes. Keep dgVoodoo requirements fully pinned: archive URL, SHA-256, size, extracted file hashes, and managed configuration.

## Sources of truth

- [Curated game profiles](curated_games.json)
- [Canonical game targets](../../games/match-registry.json)
- [Manifest generator](generate-manifest.mjs)
- [Manifest schema](manifest-v1.schema.json)
- [Wiki drift workflow](../../../.github/workflows/wiki-drift.yml)
