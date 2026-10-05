/**
 * Validate a recovery/backup file with the app's own import code.
 *
 * Reads the file, feeds it through `importBackup` against an empty store and
 * prints what the app would end up with - the same path the Restore button uses.
 */
import { readFileSync } from "node:fs";
import { register } from "node:module";

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
}

const globals = globalThis as unknown as {
  localStorage: MemoryStorage;
  window: { dispatchEvent: () => boolean };
};
globals.localStorage = new MemoryStorage();
globals.window = { dispatchEvent: () => true };

register(new URL("./ts-path-resolver.mjs", import.meta.url));

const { importBackup } = await import("../src/lib/backup.ts");
const { loadAllSnapshots } = await import("../src/lib/usage-snapshots.ts");

const file = process.argv[2];
if (!file) {
  console.error("usage: node --experimental-strip-types scripts/check-backup-file.ts <file.json>");
  process.exit(2);
}

const json = readFileSync(file, "utf8");
const summary = importBackup(json);
console.log("import summary:", JSON.stringify(summary));

const snapshots = loadAllSnapshots();
for (const [accountId, snapshot] of Object.entries(snapshots)) {
  console.log(
    [
      accountId,
      `local=${snapshot.local.totalTokens}`,
      `requests=${snapshot.local.totalRequests}`,
      `cost=${snapshot.local.totalCost.toFixed(4)}`,
      `baseline=${snapshot.cumulative.totalTokens}`,
      `seeded=${snapshot.seeded}`,
      `resets=${snapshot.resetCount}`,
      `days=${Object.keys(snapshot.days).length}`,
      `lastSync=${snapshot.lastSyncAt}`,
    ].join("  ")
  );
}
