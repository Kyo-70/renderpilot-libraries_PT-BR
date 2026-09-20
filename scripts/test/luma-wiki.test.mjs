import assert from "node:assert/strict";
import test from "node:test";

import {
  lumaWikiNoteFingerprint,
  parseLumaWikiRows,
  reconcileLumaStatuses,
} from "../lib/luma-wiki.mjs";

test("parseLumaWikiRows extracts Completed, WIP, and Unreal status tables", () => {
  const rows = parseLumaWikiRows(`
| Name | Download Link | Status |
| --- | --- | --- |
| [Exact Game](https://example.test) | Luma-Exact.zip | ✅ |
| Planned | Luma-Planned.zip | 💡 |

| Name | Author | Status |
| --- | --- | --- |
| Work in Progress | Maintainer | 🚧 |

| Name | DLSS/FSR | HDR |
| --- | --- | --- |
| Unreal Game | ✅ | |
`);

  assert.deepEqual(rows, [
    {
      name: "Exact Game",
      status: "working",
      asset: "Luma-Exact.zip",
      section: "completed",
      note: null,
    },
    {
      name: "Planned",
      status: "unknown",
      asset: "Luma-Planned.zip",
      section: "completed",
      note: null,
    },
    {
      name: "Work in Progress",
      status: "construction",
      asset: null,
      section: "wip",
      note: null,
    },
    {
      name: "Unreal Game",
      status: "working",
      asset: "Luma-Unreal_Engine.zip",
      section: "unreal",
      features: { dlss_fsr: "supported", hdr: "unknown" },
      note: null,
    },
  ]);
});

test("reconcileLumaStatuses uses unique asset, normalized names, and explicit aliases only", () => {
  const curatedGames = [
    { id: "exact", name: "Exact Game", asset: "Luma-Exact.zip", status: "unknown" },
    {
      id: "alias",
      name: "Dying Light 2 Stay Human",
      asset: "Luma-Dying_Light_2.zip",
      wiki_aliases: ["Dying Light 2"],
      status: "unknown",
    },
    {
      id: "unreal-one",
      name: "Unreal One",
      asset: "Luma-Unreal_Engine.zip",
      profile: "unreal",
      features: { dlss_fsr: "unknown", hdr: "unknown" },
      status: "unknown",
    },
    {
      id: "unreal-two",
      name: "Unreal Two",
      asset: "Luma-Unreal_Engine.zip",
      profile: "unreal",
      features: { dlss_fsr: "unknown", hdr: "unknown" },
      status: "unknown",
    },
  ];
  const result = reconcileLumaStatuses({
    curatedGames,
    wikiRows: [
      {
        name: "Different display name",
        status: "working",
        asset: "Luma-Exact.zip",
        section: "completed",
      },
      { name: "Dying Light 2", status: "construction", asset: null, section: "wip" },
      {
        name: "Unreal One",
        status: "working",
        asset: "Luma-Unreal_Engine.zip",
        section: "unreal",
      },
      {
        name: "Unknown",
        status: "working",
        asset: "Luma-Unreal_Engine.zip",
        section: "unreal",
      },
    ],
  });

  assert.deepEqual(
    result.changes.map(({ id, from, to }) => ({ id, from, to })),
    [
      { id: "exact", from: "unknown", to: "working" },
      { id: "alias", from: "unknown", to: "construction" },
      { id: "unreal-one", from: "unknown", to: "working" },
    ],
  );
  assert.deepEqual(result.unmatched, ["Unreal Two"]);
  assert.equal(result.notInCurated.length, 1);
  assert.equal(result.ambiguous.length, 0);
  assert.equal(
    result.nextCuratedGames.find((game) => game.id === "exact").status,
    "working",
  );
  assert.equal(curatedGames[0].status, "unknown", "input remains immutable");
  assert.deepEqual(
    result.nextCuratedGames.find((game) => game.id === "unreal-one").features,
    { dlss_fsr: "unknown", hdr: "unknown" },
  );
});

test("parseLumaWikiRows maps every explicit feature marker and leaves blank cells unknown", () => {
  const [row] = parseLumaWikiRows(`
| Name | DLSS/FSR | HDR |
| --- | --- | --- |
| Feature Matrix | 🚧 | ⛔ |
`);
  assert.deepEqual(row.features, { dlss_fsr: "experimental", hdr: "unsupported" });
});

test("parseLumaWikiRows accepts a feature table with only an HDR column", () => {
  const [row] = parseLumaWikiRows(`
| Name | HDR |
| --- | --- |
| HDR only | ✅ |
`);

  assert.deepEqual(row.features, { dlss_fsr: "unknown", hdr: "supported" });
});

test("parseLumaWikiRows does not invent features outside the UE matrix", () => {
  const rows = parseLumaWikiRows(`
| Name | Download Link | Status |
| --- | --- | --- |
| No feature columns | Luma-No_Features.zip | ✅ |
`);

  assert.equal(rows[0].features, undefined);
});

test("reconcileLumaStatuses blocks a changed Wiki note without publishing its raw text", () => {
  const result = reconcileLumaStatuses({
    curatedGames: [
      {
        id: "wiki-game",
        name: "Wiki Game",
        asset: "Luma-Unreal_Engine.zip",
        profile: "unreal",
        status: "unknown",
        features: { dlss_fsr: "unknown", hdr: "unknown" },
        wiki_note_reviews: [
          {
            section: "unreal",
            name: "Wiki Game",
            fingerprint: lumaWikiNoteFingerprint("Reviewed instruction"),
            disposition: "published",
            guidance_ids: ["luma.wiki-game.warning"],
          },
        ],
      },
    ],
    wikiRows: [
      {
        name: "Wiki Game",
        section: "unreal",
        asset: "Luma-Unreal_Engine.zip",
        status: "working",
        features: { dlss_fsr: "supported", hdr: "unknown" },
        note: "Changed upstream instruction",
      },
    ],
  });

  assert.deepEqual(result.reviewDrift, [
    { type: "changed", section: "unreal", name: "Wiki Game", game: "Wiki Game" },
  ]);
});

test("reconcileLumaStatuses requires typed Engine.ini guidance for published UE notes", () => {
  const note =
    "Recommended to use `r.motionblur.amount=0` via Engine.ini for motion clarity";
  const result = reconcileLumaStatuses({
    curatedGames: [
      {
        id: "engine-note",
        name: "Engine Note",
        asset: "Luma-Unreal_Engine.zip",
        profile: "unreal",
        status: "unknown",
        features: { dlss_fsr: "unknown", hdr: "unknown" },
        guidance: [
          {
            id: "engine-note.warning",
            kind: "warning",
            fallback_text: "A warning.",
          },
          {
            id: "engine-note.engine_ini",
            kind: "engine_ini",
            fallback_text: "Configure Engine.ini.",
          },
        ],
        wiki_note_reviews: [
          {
            section: "unreal",
            name: "Engine Note",
            fingerprint: lumaWikiNoteFingerprint(note),
            disposition: "published",
            guidance_ids: ["engine-note.warning"],
          },
        ],
      },
    ],
    wikiRows: [
      {
        name: "Engine Note",
        section: "unreal",
        asset: "Luma-Unreal_Engine.zip",
        status: "working",
        features: { dlss_fsr: "supported", hdr: "unknown" },
        note,
      },
    ],
  });

  assert.deepEqual(result.reviewDrift, [
    {
      type: "missing_typed_engine_ini",
      section: "unreal",
      name: "Engine Note",
      game: "Engine Note",
    },
  ]);
});

test("reconcileLumaStatuses rejects a referenced Engine.ini item without a recipe", () => {
  const note = "Set the Engine.ini value for sharper motion.";
  const result = reconcileLumaStatuses({
    curatedGames: [
      {
        id: "untyped-engine-note",
        name: "Untyped Engine Note",
        asset: "Luma-Unreal_Engine.zip",
        profile: "unreal",
        status: "unknown",
        features: { dlss_fsr: "unknown", hdr: "unknown" },
        guidance: [
          {
            id: "untyped-engine-note.engine_ini",
            kind: "engine_ini",
            fallback_text: "Configure Engine.ini.",
          },
          {
            id: "untyped-engine-note.warning",
            kind: "warning",
            fallback_text: "A warning.",
          },
        ],
        wiki_note_reviews: [
          {
            section: "unreal",
            name: "Untyped Engine Note",
            fingerprint: lumaWikiNoteFingerprint(note),
            disposition: "published",
            guidance_ids: ["untyped-engine-note.engine_ini"],
          },
        ],
      },
    ],
    wikiRows: [
      {
        name: "Untyped Engine Note",
        section: "unreal",
        asset: "Luma-Unreal_Engine.zip",
        status: "working",
        features: { dlss_fsr: "supported", hdr: "unknown" },
        note,
      },
    ],
  });

  assert.deepEqual(result.reviewDrift, [
    {
      type: "missing_typed_engine_ini",
      section: "unreal",
      name: "Untyped Engine Note",
      game: "Untyped Engine Note",
    },
  ]);
});

test("reconcileLumaStatuses rejects a referenced malformed Engine.ini recipe", () => {
  const note = "Set the Engine.ini value for sharper motion.";
  const result = reconcileLumaStatuses({
    curatedGames: [
      {
        id: "malformed-engine-note",
        name: "Malformed Engine Note",
        asset: "Luma-Unreal_Engine.zip",
        profile: "unreal",
        status: "unknown",
        features: { dlss_fsr: "unknown", hdr: "unknown" },
        guidance: [
          {
            id: "malformed-engine-note.engine_ini",
            kind: "engine_ini",
            fallback_text: "Configure Engine.ini.",
            engine_ini: {},
          },
        ],
        wiki_note_reviews: [
          {
            section: "unreal",
            name: "Malformed Engine Note",
            fingerprint: lumaWikiNoteFingerprint(note),
            disposition: "published",
            guidance_ids: ["malformed-engine-note.engine_ini"],
          },
        ],
      },
    ],
    wikiRows: [
      {
        name: "Malformed Engine Note",
        section: "unreal",
        asset: "Luma-Unreal_Engine.zip",
        status: "working",
        features: { dlss_fsr: "supported", hdr: "unknown" },
        note,
      },
    ],
  });

  assert.deepEqual(result.reviewDrift, [
    {
      type: "missing_typed_engine_ini",
      section: "unreal",
      name: "Malformed Engine Note",
      game: "Malformed Engine Note",
    },
  ]);
});

test("reconcileLumaStatuses permits an explicitly omitted Engine.ini note", () => {
  const note = "Modify Engine.ini only for an unsupported experiment.";
  const result = reconcileLumaStatuses({
    curatedGames: [
      {
        id: "omitted-engine-note",
        name: "Omitted Engine Note",
        asset: "Luma-Unreal_Engine.zip",
        profile: "unreal",
        status: "unknown",
        features: { dlss_fsr: "unknown", hdr: "unknown" },
        wiki_note_reviews: [
          {
            section: "unreal",
            name: "Omitted Engine Note",
            fingerprint: lumaWikiNoteFingerprint(note),
            disposition: "omitted",
            reason: "Not suitable for a general profile.",
          },
        ],
      },
    ],
    wikiRows: [
      {
        name: "Omitted Engine Note",
        section: "unreal",
        asset: "Luma-Unreal_Engine.zip",
        status: "working",
        features: { dlss_fsr: "supported", hdr: "unknown" },
        note,
      },
    ],
  });

  assert.deepEqual(result.reviewDrift, []);
});

test("reconcileLumaStatuses rejects conflicting asset and name matches", () => {
  const result = reconcileLumaStatuses({
    curatedGames: [
      { id: "asset", name: "Asset Match", asset: "Luma-Asset.zip", status: "unknown" },
      { id: "name", name: "Name Match", asset: "Luma-Name.zip", status: "unknown" },
    ],
    wikiRows: [
      {
        name: "Name Match",
        status: "working",
        asset: "Luma-Asset.zip",
        section: "completed",
      },
    ],
  });

  assert.deepEqual(result.changes, []);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(result.unmatched, ["Asset Match", "Name Match"]);
});

test("reconcileLumaStatuses ignores notes on uncurated completed mods without release asset", () => {
  const result = reconcileLumaStatuses({
    curatedGames: [
      { id: "curated", name: "Curated Game", asset: "Luma-Curated.zip", status: "working" },
    ],
    wikiRows: [
      {
        name: "External Nexus Mod",
        status: "working",
        asset: null,
        section: "completed",
        note: "Requires external download",
      },
    ],
  });

  assert.equal(result.notInCurated.length, 1);
  assert.deepEqual(result.reviewDrift, []);
  assert.deepEqual(result.completenessIssues, []);
});
