// The Vault key: kept in memory only, sent with every Vault call, and dropped
// the moment the engine says "locked" (restart, mode switch). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, getSideWork, hasVaultKey, unlockVault } from "../src/api.ts";

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("the key is sent, and a 'locked' answer forgets it", async () => {
  const sent: (string | null)[] = [];
  globalThis.fetch = (async (path: string, init?: RequestInit) => {
    if (path === "/api/vault/unlock") return answer(200, { key: "k1" });
    sent.push(new Headers(init?.headers).get("X-Vault-Key"));
    return answer(403, { detail: "Vault is locked." });
  }) as typeof fetch;

  await unlockVault();
  assert.equal(hasVaultKey(), true);
  await assert.rejects(getSideWork(), (e: unknown) => e instanceof ApiError && e.status === 403);
  assert.deepEqual(sent, ["k1"]);
  assert.equal(hasVaultKey(), false);
});

test("a 'locked' answer to a save tells the screen to show the lock again", async () => {
  const { addEntry, onVaultLocked } = await import("../src/api.ts");
  globalThis.fetch = (async (path: string) =>
    path === "/api/vault/unlock"
      ? answer(200, { key: "k2" })
      : answer(403, { detail: "Vault is locked." })) as typeof fetch;
  let told = 0;
  const stop = onVaultLocked(() => told++);
  await unlockVault();
  await assert.rejects(addEntry({ worked_on: "2026-03-10", currency: "CAD" }));
  assert.equal(told, 1);
  stop();
});
