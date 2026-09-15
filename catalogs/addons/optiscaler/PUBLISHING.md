# OptiScaler release and compatibility publishing

`manifest-source.json` is the reviewed release-only source of truth. It keeps each unique
installable member once in `member_catalog`, keyed by its lowercase SHA-256.
Release records reference those keys in archive order. Generation expands the
references into the flat `addons/v1/optiscaler.json` document consumed by
RenderPilot.

The catalogue contains metadata only. OptiScaler archives and OptiPatcher stay
on their official GitHub Release assets; RenderPilot does not mirror them. The
client verifies the declared digest and size before installation. README,
license, and upstream setup files are intentionally absent from the install map.

## Immutable history

Retain every official stable release from v0.9.0 onward. Release IDs must be
exact `vX.Y.Z` tags, and an upstream rebuild must receive a new release record.
Never replace a reviewed archive hash, size, member identity, or configuration
schema in place. The integrity baseline requires an explicit test update for
every newly reviewed release.

Independently distributed module artifacts follow the same rule. They must use
the approved official repository, an immutable `v`-numeric release tag, exact
asset name, SHA-256, size, target, and architecture. Do not use rolling,
latest, branch, or mutable-release aliases.

## Adding a release

1. Verify the official tag and `.7z` asset, including archive SHA-256 and size.
2. Inspect the installable archive members and record each member's SHA-256,
   size, target, module, and PE identity. Reuse an existing `member_catalog`
   entry only when all of that metadata is identical.
3. Add the release with its ordered member hashes. Review module compatibility
   and configuration migrations.
4. Update `current_release` and `revision` only after review.
5. Add the release's full record identity to the immutable test baseline, then
   run:

   ```powershell
   pnpm run generate:optiscaler
   pnpm run test:optiscaler
   pnpm run check:offline
   ```

The generated manifest is published at the unchanged R2 key
`addons/v1/optiscaler.json`.

## Compatibility catalogue

Compatibility is independent from releases and is advisory rather than a
complete source of product truth. The generated catalogue never turns a
missing game into an incompatibility claim. It has two public documents:

- `addons/v1/optiscaler-compatibility.json` holds only exact identities,
  typed installation policy, and reviewed message references;
- `addons/v1/optiscaler-compatibility-messages.json` is the stable English
  runtime fallback contract. Reviewed translations are authoring data and are
  compiled into trusted application snapshots rather than served as mutable
  runtime prose.

The checked-in upstream snapshot is tooling evidence only. It may contain raw
titles and notes, while generated runtime files must not. Every snapshot row
has a fingerprint-bound review disposition. Every nonempty note is separately
classified as typed policy, localized guidance, or explicitly omitted. A
`pending_identity` row has no exact runtime identity and is never published.

Run `pnpm run sync:optiscaler-wiki:check` in CI. It fetches the official list
and rejects upstream or review drift. `pnpm run sync:optiscaler-wiki` updates a
changed snapshot then intentionally fails until the review ledger is reconciled.
The one-time `--bootstrap-ledger` mode marks every row pending identity for a
new snapshot; it must not be used to publish a game.

Each curated entry references one exact game or edition target in
[`catalogs/games/match-registry.json`](../../games/match-registry.json). The
target owns the complete verified identity set and provenance; OptiScaler
authoring owns only OptiScaler policy. Never infer a target from titles,
engines, generic rules, or fuzzy matching. A bare executable leaf is allowed
only when it is globally unambiguous. Technical wiki statements become typed
variants and are never copied into user guidance. Guidance and its `de`, `es`, `fr`,
`ja`, `pt-BR`, `ru`, `zh-Hans`, and `zh-Hant` translations have one editable source in
`compatibility/messages.json`. Consumer repositories derive their checked-in
localization snapshots deterministically from this source; those snapshots are
not independently authored translations.

Normal generation is offline and deterministic:

```powershell
pnpm run generate:optiscaler-compatibility
pnpm run check:optiscaler-compatibility
pnpm run test:optiscaler
```

After changing compatibility guidance or translations, regenerate the
desktop's trusted snapshots from the `renderpilot` repository:

```powershell
pnpm --dir apps/desktop i18n:optiscaler-sync --write --producer-root <renderpilot-libraries-path>
```
