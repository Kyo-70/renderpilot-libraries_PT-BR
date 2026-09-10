import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAppid, normalizeExeName } from "../lib/overlay-shared.mjs";

test("normalizes appids and exe basenames", () => {
  assert.equal(normalizeAppid(123, "appid"), "123");
  assert.equal(normalizeAppid(" 456 ", "appid"), "456");
  assert.equal(normalizeExeName(" Game.EXE ", "exe"), "Game.EXE");

  assert.throws(() => normalizeAppid("0", "appid"), /positive Steam AppID/);
  assert.throws(() => normalizeExeName("bin/Game.exe", "exe"), /basename/);
  assert.throws(() => normalizeExeName("Ga<me.exe", "exe"), /basename/);
});
