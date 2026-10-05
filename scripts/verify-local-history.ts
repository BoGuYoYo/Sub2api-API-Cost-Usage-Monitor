/**
 * Runtime checks for the local history model.
 *
 * Run with:  node --experimental-strip-types scripts/verify-local-history.ts
 * (or `npm run verify:history`). These assertions guard the promise that a
 * relay which clears its data can never shrink the locally kept totals.
 */
class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

// The app's modules use Vite-style extension-less imports; teach Node to find
// the matching .ts files before anything is loaded.
const { register } = await import("node:module");
register(new URL("./ts-path-resolver.mjs", import.meta.url));

const { syncAccountStats, recordUsageForAccount, getAccountSnapshot, mergeAccountSnapshot } =
  await import("../src/lib/usage-snapshots.ts");
const { obfuscateSecret, revealSecret, hasRecoverableSecret } = await import(
  "../src/lib/secret-store.ts"
);

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok   ${label}`);
  }
}

function stats(totalTokens: number, totalRequests: number, totalCost: number) {
  return {
    total_tokens: totalTokens,
    total_requests: totalRequests,
    total_actual_cost: totalCost,
    today_tokens: 5,
    today_requests: 1,
    today_actual_cost: 0.01,
  };
}

const ACCOUNT = "acc-1";

console.log("first sync seeds the local total from the relay's all-time totals");
syncAccountStats(ACCOUNT, stats(1000, 10, 1));
check("local seeded", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 1000);
check("seeded flag", getAccountSnapshot(ACCOUNT)?.seeded, true);

console.log("later syncs add only the positive difference");
let result = syncAccountStats(ACCOUNT, stats(1500, 14, 1.4));
check("delta tokens", result.deltaTokens, 500);
check("local total", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 1500);

result = syncAccountStats(ACCOUNT, stats(1500, 14, 1.4));
check("no delta when nothing changed", result.deltaTokens, 0);
check("local total unchanged", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 1500);

console.log("a relay data wipe is detected and never shrinks local history");
result = syncAccountStats(ACCOUNT, stats(0, 0, 0));
check("reset detected", result.resetDetected, true);
check("local total survives the wipe", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 1500);
check("reset counter", getAccountSnapshot(ACCOUNT)?.resetCount, 1);
check("server baseline re-based", getAccountSnapshot(ACCOUNT)?.cumulative.totalTokens, 0);

console.log("usage after the wipe keeps accumulating on top of the old total");
result = syncAccountStats(ACCOUNT, stats(200, 2, 0.2));
check("delta after reset", result.deltaTokens, 200);
check("local total continues", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 1700);

console.log("a second drop is counted as another reset");
result = syncAccountStats(ACCOUNT, stats(1000, 9, 0.9));
check("growth is still counted after the reset", result.deltaTokens, 800);
check("local total after growth", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 2500);
result = syncAccountStats(ACCOUNT, stats(300, 3, 0.3));
check("reset detected again", result.resetDetected, true);
check("local total still intact", getAccountSnapshot(ACCOUNT)?.local.totalTokens, 2500);
check("reset counter", getAccountSnapshot(ACCOUNT)?.resetCount, 2);

console.log("per-day history keeps the largest value it ever observed");
recordUsageForAccount(ACCOUNT, [
  { id: 1, total_tokens: 100, input_tokens: 40, output_tokens: 60, actual_cost: 0.1 },
]);
recordUsageForAccount(ACCOUNT, [
  { id: 1, total_tokens: 30, input_tokens: 10, output_tokens: 20, actual_cost: 0.03 },
]);
const today = new Date();
const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
  today.getDate()
).padStart(2, "0")}`;
check("day tokens keep the max", getAccountSnapshot(ACCOUNT)?.days[key]?.totalTokens, 100);
check("day cost keeps the max", getAccountSnapshot(ACCOUNT)?.days[key]?.cost, 0.1);

console.log("snapshot merging never loses the larger history");
const merged = mergeAccountSnapshot(
  {
    accountId: ACCOUNT,
    lastSyncAt: "2026-01-02T00:00:00.000Z",
    local: { totalTokens: 1700, totalRequests: 17, totalCost: 1.7, todayTokens: 0, todayRequests: 0, todayCost: 0 },
    cumulative: { totalTokens: 300, totalRequests: 3, totalCost: 0.3, todayTokens: 0, todayRequests: 0, todayCost: 0 },
    seeded: true,
    resetCount: 2,
    days: {},
  },
  {
    accountId: ACCOUNT,
    lastSyncAt: "2026-01-01T00:00:00.000Z",
    local: { totalTokens: 900, totalRequests: 9, totalCost: 0.9, todayTokens: 0, todayRequests: 0, todayCost: 0 },
    cumulative: { totalTokens: 900, totalRequests: 9, totalCost: 0.9, todayTokens: 0, todayRequests: 0, todayCost: 0 },
    seeded: true,
    resetCount: 1,
    days: {},
  }
);
check("merged local keeps the larger total", merged?.local.totalTokens, 1700);
check("merged baseline keeps the larger reading", merged?.cumulative.totalTokens, 900);
check("merged reset count", merged?.resetCount, 2);

console.log("older snapshots (v2) migrate into the local model");
storage.clear();
storage.setItem(
  "sub2api_usage_snapshots_v2",
  JSON.stringify({
    "acc-legacy": {
      accountId: "acc-legacy",
      lastSyncAt: "2025-12-01T00:00:00.000Z",
      cumulative: {
        totalTokens: 4242,
        totalRequests: 42,
        totalCost: 4.2,
        todayTokens: 10,
        todayRequests: 1,
        todayCost: 0.1,
      },
      days: {},
    },
  })
);
check("legacy total becomes the local total", getAccountSnapshot("acc-legacy")?.local.totalTokens, 4242);
check("legacy snapshot stays seeded", getAccountSnapshot("acc-legacy")?.seeded, true);

console.log("saved passwords round-trip and reject tampering");
const sealed = obfuscateSecret("hunter2");
check("ciphertext does not contain the password", sealed.includes("hunter2"), false);
check("password round-trips", revealSecret(sealed), "hunter2");
check("recognised as recoverable", hasRecoverableSecret(sealed), true);
check("tampered payload is rejected", revealSecret(`${sealed}AAA`), "");
check("empty secret stays empty", obfuscateSecret(""), "");

console.log("a different installation key cannot read the secret");
const before = storage.getItem("sub2api_device_key");
storage.setItem("sub2api_device_key", "another-device-key");
check("secret is unreadable with a foreign key", revealSecret(sealed), "");
storage.setItem("sub2api_device_key", before ?? "");
check("secret readable again with the original key", revealSecret(sealed), "hunter2");

console.log("a backup restores accounts and merges usage history without shrinking it");
// The accounts layer dispatches window events; plain Node needs a stub.
(globalThis as unknown as { window: { dispatchEvent: () => boolean } }).window = {
  dispatchEvent: () => true,
};
const { loadAccounts } = await import("../src/lib/accounts.ts");
const { importBackup, createBackup } = await import("../src/lib/backup.ts");

const localAccount = {
  id: "acc-backup",
  name: "Local name",
  baseUrl: "https://relay.example.com/api/v1",
  username: "user@example.com",
  accessToken: "local-token",
  refreshToken: "",
  expiresAt: null,
  autoRelogin: false,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
storage.clear();
storage.setItem("sub2api_accounts_v3", JSON.stringify([localAccount]));
storage.setItem(
  "sub2api_usage_snapshots_v3",
  JSON.stringify({
    "acc-backup": {
      accountId: "acc-backup",
      lastSyncAt: "2026-01-02T00:00:00.000Z",
      local: { totalTokens: 5000, totalRequests: 50, totalCost: 5, todayTokens: 0, todayRequests: 0, todayCost: 0 },
      cumulative: { totalTokens: 3000, totalRequests: 30, totalCost: 3, todayTokens: 0, todayRequests: 0, todayCost: 0 },
      seeded: true,
      resetCount: 0,
      days: {},
    },
  })
);

const backupJson = JSON.stringify({
  app: "sub2api-api-cost-usage-monitor",
  version: 2,
  exportedAt: "2026-01-05T00:00:00.000Z",
  deviceKey: obfuscateSecret("key-probe") ? storage.getItem("sub2api_device_key") : undefined,
  accounts: [
    {
      ...localAccount,
      name: "Restored name",
      password: obfuscateSecret("relay-password"),
      autoRelogin: true,
      updatedAt: "2026-01-05T00:00:00.000Z",
    },
  ],
  snapshots: {
    "acc-backup": {
      accountId: "acc-backup",
      lastSyncAt: "2026-01-04T00:00:00.000Z",
      local: { totalTokens: 9000, totalRequests: 90, totalCost: 9, todayTokens: 0, todayRequests: 0, todayCost: 0 },
      cumulative: { totalTokens: 9000, totalRequests: 90, totalCost: 9, todayTokens: 0, todayRequests: 0, todayCost: 0 },
      seeded: true,
      resetCount: 1,
      days: {},
    },
  },
});

const summary = importBackup(backupJson);
check("account merged", summary.accountsUpdated, 1);
check("no duplicates added", loadAccounts().length, 1);
check("newer backup record wins", loadAccounts()[0].name, "Restored name");
check("saved password comes back", revealSecret(loadAccounts()[0].password), "relay-password");
check("automatic sign-in re-enabled", loadAccounts()[0].autoRelogin, true);
check("usage merged upward", getAccountSnapshot("acc-backup")?.local.totalTokens, 9000);

console.log("a fresh install adopts the backup's device key");
console.log(`  (backup payload from ${createBackup().accounts.length} local account(s))`);
storage.clear();
const freshSummary = importBackup(backupJson);
check("account restored on a clean install", freshSummary.accountsAdded, 1);
check("password usable after restore", freshSummary.passwordsRestored, 1);
check("password readable on the new install", revealSecret(loadAccounts()[0].password), "relay-password");
check("history restored", getAccountSnapshot("acc-backup")?.local.totalTokens, 9000);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exitCode = 1;
}
