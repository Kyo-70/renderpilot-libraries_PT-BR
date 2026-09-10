import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPunctuationlessSearchTerm,
  buildSearchTerms,
  buildVariantBaseSearchTerm,
  findBestSteamMatch,
  normalize,
  normalizeBaseTitle,
  rankSteamMatches,
  resolveSteamStoreGame,
  scoreTitleMatch,
} from "../lib/steam-search.mjs";

const AUTO_ACCEPT_SCORE = 78;

const TITLE_MATCH_CASES = [
  {
    expected: "Borderlands GOTY Enhanced",
    actual: "Borderlands Game of the Year Enhanced",
    minimumScore: 100,
  },
  {
    expected: "Heaven Burns Red",
    actual: "ヘブンバーンズレッド",
    minimumScore: 100,
  },
  {
    expected: "Bus Simulator 21",
    actual: "Bus Simulator 21 Next Stop",
    minimumScore: 88,
  },
  {
    expected: "Daylight",
    actual: "Daylight",
    minimumScore: 100,
  },
  {
    expected: "Destroy All Humans! – Clone Carnage",
    actual: "Destroy All Humans! - Clone Carnage",
    minimumScore: 100,
  },
  {
    expected: "Disco Elysium",
    actual: "Disco Elysium - The Final Cut",
    minimumScore: 88,
  },
  {
    expected: "DRAGON QUEST XI: Echoes of an Elusive Age",
    actual: "DRAGON QUEST® XI S: Echoes of an Elusive Age™ - Definitive Edition",
    minimumScore: 78,
  },
  {
    expected: "ECHO",
    actual: "ECHO",
    minimumScore: 100,
  },
  {
    expected: "Little Nightmares Enhanced Edition",
    actual: "Little Nightmares Enhanced Edition",
    minimumScore: 100,
  },
  {
    expected: "S.T.A.L.K.E.R.: Call of Prypiat",
    actual: "STALKER: Call of Prypiat",
    minimumScore: 100,
  },
  {
    expected: "Ballex²: The Hanging Gardens",
    actual: "Ballex 2: The Hanging Gardens",
    minimumScore: 100,
  },
  {
    expected: "Roundtrip",
    actual: "Round Trip",
    minimumScore: 100,
  },
  {
    expected: "Wonderball",
    actual: "Wonder Ball",
    minimumScore: 100,
  },
  {
    expected: "DCS World",
    actual: "DCS World Steam Edition",
    minimumScore: 100,
  },
  {
    expected: "Desordre",
    actual: "DESORDRE : A Puzzle Game Adventure",
    minimumScore: 100,
  },
  {
    expected: "Jump Space (formerly Jump Ship)",
    actual: "Jump Space",
    minimumScore: 100,
  },
  {
    expected: "METAL GEAR SOLID DELTA: SNAKE EATER",
    actual: "METAL GEAR SOLID Δ: SNAKE EATER",
    minimumScore: 100,
  },
  {
    expected: "Microsoft Flight Simulator 2020",
    actual: "Microsoft Flight Simulator (2020) 40th Anniversary Edition",
    minimumScore: 100,
  },
  {
    expected: "Neverness to Everness (NTE)",
    actual: "NTE: Neverness to Everness",
    minimumScore: 100,
  },
  {
    expected: "Ranch Simulator",
    actual: "Ranch Simulator: Build, Hunt, Farm",
    minimumScore: 100,
  },
  {
    expected: "Resident Evil 8 Village",
    actual: "Resident Evil Village",
    minimumScore: 100,
  },
  {
    expected: "Resident Evil 9 Requiem",
    actual: "Resident Evil Requiem",
    minimumScore: 100,
  },
  {
    expected: "Senua’s Saga: Hellblade II",
    actual: "Hellblade II: Senua’s Saga",
    minimumScore: 100,
  },
  {
    expected: "Stygion: Outer Gods",
    actual: "Stygian: Outer Gods",
    minimumScore: 100,
  },
  {
    expected: "Trine 5",
    actual: "Trine 5: A Clockwork Conspiracy",
    minimumScore: 100,
  },
  {
    expected: "WRC Generations",
    actual: "WRC Generations – The FIA WRC Official Game",
    minimumScore: 100,
  },
  {
    expected: "NORSE Demo",
    actual: "NORSE: Oath of Blood Demo",
    minimumScore: 100,
  },
  {
    expected: "Zouhri Demo",
    actual: "Zouhri: The Cursed Blood Demo",
    minimumScore: 100,
  },
  {
    expected: "Venus Vacation PRISM - DEAD OR ALIVE Xtreme",
    actual: "Venus Vacation PRISM - DEAD OR ALIVE Xtreme -",
    minimumScore: 100,
  },
];

function createSteamItem(id, name, type = "app") {
  return { id, name, type };
}

function assertMinimumMatchScore({ expected, actual, minimumScore }) {
  const result = scoreTitleMatch(expected, actual);

  assert.ok(
    result.score >= minimumScore,
    [
      `Expected "${expected}" to match "${actual}" with score >= ${minimumScore}.`,
      `Received ${result.score} (${result.reason}).`,
    ].join(" "),
  );
}

test("scoreTitleMatch recognizes supported title variants", async (t) => {
  for (const testCase of TITLE_MATCH_CASES) {
    await t.test(`${testCase.expected} -> ${testCase.actual}`, () => {
      assertMinimumMatchScore(testCase);
    });
  }
});
test("normalize preserves edition markers in strict identity", () => {
  assert.notEqual(
    normalize("Little Nightmares"),
    normalize("Little Nightmares Enhanced Edition"),
  );
});

test("normalizeBaseTitle ignores edition markers", () => {
  assert.equal(
    normalizeBaseTitle("Little Nightmares"),
    normalizeBaseTitle("Little Nightmares Enhanced Edition"),
  );

  assert.equal(
    normalizeBaseTitle("Disco Elysium"),
    normalizeBaseTitle("Disco Elysium - The Final Cut"),
  );

  assert.notEqual(
    normalizeBaseTitle("Fame Fatale"),
    normalizeBaseTitle("Final Cut: Fame Fatale"),
  );
});

test("punctuationless fallback expands search recall without changing title acceptance", () => {
  assert.equal(
    buildPunctuationlessSearchTerm("DragonSword : Awakening"),
    "DragonSword Awakening",
  );
  assert.equal(buildPunctuationlessSearchTerm("VOID/BREAKER"), "VOID BREAKER");
  assert.equal(buildPunctuationlessSearchTerm("Protocol:Terminate"), "Protocol Terminate");
  assert.equal(
    buildPunctuationlessSearchTerm("S.T.A.L.K.E.R.: Call of Prypiat"),
    "STALKER Call of Prypiat",
  );
  assert.equal(
    scoreTitleMatch("DragonSword : Awakening", "DragonSword: Awakening").score,
    100,
  );
});

test("compatibility numerals gain a boundary without splitting ordinary initialisms", () => {
  assert.equal(
    scoreTitleMatch("Ballex²: The Hanging Gardens", "Ballex 2: The Hanging Gardens").score,
    100,
  );
  assert.ok(
    scoreTitleMatch("F1 2020", "Sim Racing Telemetry - F1 2020").score < AUTO_ACCEPT_SCORE,
  );
});

test("conflicting explicit release years cannot be accepted", () => {
  const conflict = scoreTitleMatch("Example Game (2020)", "Example Game (2021)");
  assert.equal(conflict.score, 0);
  assert.equal(conflict.reason, "conflicting-release-years");

  const candidateWithoutYear = scoreTitleMatch("Example Game (2020)", "Example Game");
  assert.equal(candidateWithoutYear.score, 100);
});

test("yearless candidates remain eligible and retain ambiguity detection", () => {
  const first = createSteamItem(1, "Example Game");
  const second = createSteamItem(2, "Example Game");
  const resolution = findBestSteamMatch("Example Game (2020)", [first, second]);

  assert.equal(resolution.score, 100);
  assert.equal(resolution.ambiguous, true);
});

test("a requested edition does not resolve to the base game", () => {
  const enhancedResult = scoreTitleMatch(
    "Little Nightmares Enhanced Edition",
    "Little Nightmares",
  );

  assert.ok(
    enhancedResult.score < AUTO_ACCEPT_SCORE,
    `Expected score below ${AUTO_ACCEPT_SCORE}, received ${enhancedResult.score}.`,
  );

  assert.equal(enhancedResult.reason, "requested-edition-missing");

  const finalCutResult = scoreTitleMatch("Disco Elysium - The Final Cut", "Disco Elysium");

  assert.ok(finalCutResult.score < AUTO_ACCEPT_SCORE);
  assert.equal(finalCutResult.reason, "requested-edition-missing");
});

test("an exact two-word base title resolves to its added edition", () => {
  const game = createSteamItem(632470, "Disco Elysium - The Final Cut");
  const soundtrackAndArtbook = createSteamItem(
    1173140,
    "Disco Elysium - Soundtrack and Artbooklet",
  );
  const finalCutSoundtrack = createSteamItem(
    1233220,
    "Disco Elysium - The Final Cut Soundtrack",
  );

  const resolution = findBestSteamMatch("Disco Elysium", [
    soundtrackAndArtbook,
    finalCutSoundtrack,
    game,
  ]);

  assert.deepEqual(resolution.item, game);
  assert.ok(resolution.score >= AUTO_ACCEPT_SCORE);
  assert.equal(resolution.reason, "base-title-with-added-edition");
  assert.equal(resolution.ambiguous, false);
  assert.ok(
    scoreTitleMatch("Disco Elysium", soundtrackAndArtbook.name).score < AUTO_ACCEPT_SCORE,
  );
  assert.ok(
    scoreTitleMatch("Disco Elysium", finalCutSoundtrack.name).score < AUTO_ACCEPT_SCORE,
  );
});

test("an added edition does not make a one-word title safe to resolve", () => {
  const result = scoreTitleMatch("Control", "Control Ultimate Edition");

  assert.ok(
    result.score < AUTO_ACCEPT_SCORE,
    `Expected score below ${AUTO_ACCEPT_SCORE}, received ${result.score}.`,
  );
});

test("edition, DLC, soundtrack, and demo candidates stay below automatic acceptance", () => {
  for (const [expected, actual] of [
    ["Example Game Ultimate Edition", "Example Game"],
    ["Example Game", "Example Game - Expansion DLC"],
    ["Example Game", "Example Game Soundtrack"],
    ["Example Game", "Example Game Demo"],
  ]) {
    const result = scoreTitleMatch(expected, actual);
    assert.ok(
      result.score < AUTO_ACCEPT_SCORE,
      `${expected} -> ${actual} unexpectedly scored ${result.score} (${result.reason})`,
    );
  }
});

test("findBestSteamMatch reports equally strong matches as ambiguous", () => {
  const firstResult = createSteamItem(551770, "ECHO");
  const secondResult = createSteamItem(111111, "Echo");

  const resolution = findBestSteamMatch("ECHO", [firstResult, secondResult]);

  assert.deepEqual(resolution.item, firstResult);
  assert.equal(resolution.score, 100);
  assert.equal(resolution.reason, "exact-canonical-title");
  assert.equal(resolution.ambiguous, true);
  assert.equal(resolution.alternatives[0]?.item.id, secondResult.id);
});

test("variant suffix guard prevents demos, playtests, and preview titles from matching base games", () => {
  const mismatchCases = [
    ["The Long Dark Demo", "The Long Dark"],
    ["The Long Dark", "The Long Dark Demo"],
    ["Armatus Demo", "Armatus"],
    ["Everwind Playtest", "Everwind"],
    ["Pax Autocratica: Prologue", "Pax Autocratica"],
    ["Escape from Tarkov – SPT", "Escape from Tarkov"],
  ];

  for (const [expected, actual] of mismatchCases) {
    const result = scoreTitleMatch(expected, actual);
    assert.ok(
      result.score < AUTO_ACCEPT_SCORE,
      `${expected} <-> ${actual} expected score < ${AUTO_ACCEPT_SCORE}, got ${result.score}`,
    );
    assert.equal(result.reason, "requested-variant-missing");
  }

  // Exact matches between matching preview editions retain a canonical score of 100
  assert.equal(scoreTitleMatch("Armatus Demo", "Armatus Demo").score, 100);
  assert.equal(scoreTitleMatch("Everwind Playtest", "Everwind Playtest").score, 100);
});

test("buildVariantBaseSearchTerm extracts clean base titles across delimiters", () => {
  assert.equal(buildVariantBaseSearchTerm("Pax Autocratica: Prologue"), "Pax Autocratica");
  assert.equal(
    buildVariantBaseSearchTerm("Escape from Tarkov – SPT"),
    "Escape from Tarkov",
  );
  assert.equal(
    buildVariantBaseSearchTerm("Escape from Tarkov - SPT"),
    "Escape from Tarkov",
  );
  assert.equal(buildVariantBaseSearchTerm("Armatus Demo"), "Armatus");
  assert.equal(buildVariantBaseSearchTerm("Everwind Playtest"), "Everwind");
  assert.equal(buildVariantBaseSearchTerm("Standard Game"), "Standard Game");
});

test("auxiliary content and non-app items are capped below acceptance and do not trigger ambiguity", () => {
  const baseGame = createSteamItem(
    292030,
    "The Witcher 3: Wild Hunt - Complete Edition",
    "app",
  );
  const soundtrackApp = createSteamItem(
    1229320,
    "The Witcher 3: Wild Hunt Soundtrack",
    "app",
  );
  const musicItem = createSteamItem(999999, "The Witcher 3: Wild Hunt - Songs", "music");

  const ranked = rankSteamMatches("The Witcher 3: Wild Hunt", [
    soundtrackApp,
    musicItem,
    baseGame,
  ]);
  assert.equal(ranked[0].item.id, 292030);
  assert.equal(ranked[0].score, 90);

  // Soundtracks returned as type "app" by Store Search are capped by the lexical gate
  const soundtrackMatch = ranked.find((r) => r.item.id === 1229320);
  assert.equal(soundtrackMatch.score, 60);
  assert.equal(soundtrackMatch.reason, "auxiliary-content");

  // Non-app candidates (music, dlc, tool) are capped by the candidate type gate
  const musicMatch = ranked.find((r) => r.item.id === 999999);
  assert.equal(musicMatch.score, 60);
  assert.equal(musicMatch.reason, "non-app:music");

  // The base game cleanly wins without triggering ambiguity against capped auxiliary content
  const resolution = findBestSteamMatch("The Witcher 3: Wild Hunt", [
    soundtrackApp,
    baseGame,
  ]);
  assert.equal(resolution.item.id, 292030);
  assert.equal(resolution.ambiguous, false);

  // Legitimate titles containing auxiliary words (e.g. Wallpaper Engine) are not capped when matching themselves
  const wallpaperApp = createSteamItem(431960, "Wallpaper Engine", "app");
  const wallpaperSoundtrack = createSteamItem(431961, "Wallpaper Engine Soundtrack", "app");
  const wallpaperRanked = rankSteamMatches("Wallpaper Engine", [
    wallpaperApp,
    wallpaperSoundtrack,
  ]);
  assert.equal(wallpaperRanked[0].item.id, 431960);
  assert.equal(wallpaperRanked[0].score, 100);
  assert.equal(wallpaperRanked[0].reason, "exact-canonical-title");
  assert.ok(wallpaperRanked[1].score < AUTO_ACCEPT_SCORE);
  assert.equal(wallpaperRanked[1].reason, "auxiliary-content");
});

test("surface exact tie breaker resolves identical canonical titles with distinct punctuation", () => {
  const slashedItem = createSteamItem(2615540, "VOID/BREAKER", "app");
  const spaceItem = createSteamItem(3535050, "Void Breaker", "app");

  const resolution = findBestSteamMatch("VOID/BREAKER", [spaceItem, slashedItem]);
  assert.equal(resolution.item.id, 2615540);
  assert.equal(resolution.score, 100);
  assert.equal(resolution.ambiguous, false);

  // When candidates have identical surface exactness (e.g. true homonyms), ambiguity is strictly preserved
  const firstSherlock = createSteamItem(1949030, "Sherlock Holmes The Awakened", "app");
  const secondSherlock = createSteamItem(11140, "Sherlock Holmes The Awakened", "app");
  const sherlockRes = findBestSteamMatch("Sherlock Holmes The Awakened", [
    firstSherlock,
    secondSherlock,
  ]);
  assert.equal(sherlockRes.ambiguous, true);
});

test("RankedSteamMatch includes surfaceExact boolean and findBestSteamMatch honors custom ambiguityMargin", () => {
  const itemA = createSteamItem(100, "Example Game", "app");
  const itemB = createSteamItem(200, "Example Game Gold Edition", "app");

  const ranked = rankSteamMatches("Example Game", [itemA, itemB]);
  assert.equal(typeof ranked[0].surfaceExact, "boolean");
  assert.equal(ranked[0].surfaceExact, true);
  assert.equal(ranked[1].surfaceExact, false);

  // Default margin (3): score difference (100 vs 90 = 10) > 3 is not ambiguous
  const resDefault = findBestSteamMatch("Example Game", [itemA, itemB]);
  assert.equal(resDefault.ambiguous, false);

  // Custom margin (15): score difference (100 - 90 = 10) <= 15 triggers ambiguity
  const resWideMargin = findBestSteamMatch("Example Game", [itemA, itemB], {
    ambiguityMargin: 15,
  });
  assert.equal(resWideMargin.ambiguous, true);
});

test("[REDACTED] surface spelling wins over punctuation-lossy homonym", () => {
  const exact = createSteamItem(2229940, "[REDACTED]");
  const lossy = createSteamItem(999999, "REDACTED");

  const resolution = findBestSteamMatch("[REDACTED]", [lossy, exact]);

  assert.equal(resolution.item.id, 2229940);
  assert.equal(resolution.ambiguous, false);
});

test("buildSearchTerms generates equivalent alias terms for catalog titles", () => {
  const norseTerms = buildSearchTerms("NORSE Demo");
  assert.ok(
    norseTerms.includes("NORSE: Oath of Blood Demo"),
    `Expected NORSE Demo search terms to include "NORSE: Oath of Blood Demo", received: ${JSON.stringify(norseTerms)}`,
  );

  const zouhriTerms = buildSearchTerms("Zouhri Demo");
  assert.ok(
    zouhriTerms.includes("Zouhri: The Cursed Blood Demo"),
    `Expected Zouhri Demo search terms to include "Zouhri: The Cursed Blood Demo", received: ${JSON.stringify(zouhriTerms)}`,
  );

  const venusTerms = buildSearchTerms("Venus Vacation PRISM - DEAD OR ALIVE Xtreme");
  assert.ok(
    venusTerms.includes("Venus Vacation PRISM"),
    `Expected Venus Vacation PRISM search terms to include "Venus Vacation PRISM", received: ${JSON.stringify(venusTerms)}`,
  );
});

test("resolveSteamStoreGame performs exhaustive multi-locale search and detects cross-region ambiguities", async () => {
  const originalFetch = globalThis.fetch;
  const gameTitle = `ExGame${Date.now()} Sequel`;
  const queriedLocales = new Set();

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    const lang = parsed.searchParams.get("l");
    const country = parsed.searchParams.get("cc");
    queriedLocales.add(`${lang}:${country}`);

    if (lang === "english" && country === "US") {
      return new Response(
        JSON.stringify({
          items: [{ id: 1, name: gameTitle, type: "app" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (lang === "japanese" && country === "JP") {
      return new Response(
        JSON.stringify({
          items: [{ id: 2, name: gameTitle, type: "app" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const resolution = await resolveSteamStoreGame(gameTitle, {
      languages: ["english", "japanese"],
    });

    assert.ok(resolution !== null);
    assert.equal(resolution.ambiguous, true);
    assert.equal(resolution.score, 100);
    assert.deepEqual([...queriedLocales].sort(), ["english:US", "japanese:JP"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
