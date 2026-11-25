/** Runtime checks for range selection and model usage aggregation. */
import { register } from "node:module";

register(new URL("./ts-path-resolver.mjs", import.meta.url));

const {
  aggregateDashboardModelUsage,
  aggregateModelUsage,
  getUsageRangeBounds,
  loadModelRankingCache,
  mergeModelUsageRankings,
  saveModelRankingCache,
} = await import("../src/lib/model-usage.ts");
const {
  syncAccountModelUsage,
  getAccountOfflineModelRanking,
  getAccountModelSnapshot,
  recordModelUsageError,
  mergeAccountModelSnapshot,
  saveAllModelSnapshots,
} = await import("../src/lib/model-snapshots.ts");
const { buildUsageParams } = await import("../src/lib/api.ts");

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(
      `  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`
    );
  }
}

const now = new Date("2026-11-19T12:00:00.000Z");

console.log("usage ranges resolve to the expected dates");
check("today is a single-day range", getUsageRangeBounds("today", now), {
  startDate: "2026-11-19",
  endDate: "2026-11-19",
});
check("seven-day range includes today", getUsageRangeBounds("7d", now), {
  startDate: "2026-11-13",
  endDate: "2026-11-19",
});
check("thirty-day range includes today", getUsageRangeBounds("30d", now), {
  startDate: "2026-10-21",
  endDate: "2026-11-19",
});
check("all-time range has an explicit historical start", getUsageRangeBounds("all", now), {
  startDate: "1970-01-01",
  endDate: "2026-11-19",
});
check(
  "all-time start predates the thirty-day range",
  getUsageRangeBounds("all", now).startDate! < getUsageRangeBounds("30d", now).startDate!,
  true
);

console.log("usage query parameters preserve all-time requests");
const datedParams = buildUsageParams("2026-11-01", "2026-11-19", 2);
check("start date is included", datedParams.get("start_date"), "2026-11-01");
check("end date is included", datedParams.get("end_date"), "2026-11-19");
check("page is included", datedParams.get("page"), "2");
const allBounds = getUsageRangeBounds("all", now);
const allParams = buildUsageParams(allBounds.startDate, allBounds.endDate, 1);
check("all-time start date reaches the API", allParams.get("start_date"), "1970-01-01");
check("all-time end date reaches the API", allParams.get("end_date"), "2026-11-19");
check("all-time page size remains bounded", allParams.get("page_size"), "100");

console.log("ranking cache round-trips by range and account set");
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
const cachedRows = aggregateModelUsage(
  [{ id: 99, model: "cached-model", total_tokens: 42 }],
  "Unknown model"
);
saveModelRankingCache({
  range: "30d",
  accountIds: ["account-b", "account-a"],
  rows: cachedRows,
  fetchedAt: "2026-11-19T12:00:00.000Z",
  truncatedAccounts: [],
  failedAccounts: [],
});
check("cache restores rows", loadModelRankingCache("30d", ["account-a", "account-b"])?.rows[0]?.model, "cached-model");
check("different range does not reuse cache", loadModelRankingCache("7d", ["account-a", "account-b"]), null);

console.log("models aggregate across records and accounts");
const rows = aggregateModelUsage(
  [
    {
      id: 1,
      model: "gpt-4o",
      total_tokens: 1000,
      actual_cost: 0.1,
    },
    {
      id: 2,
      model: " gpt-4o ",
      input_tokens: 600,
      output_tokens: 400,
      actual_cost: null,
      total_cost: 0.2,
    },
    {
      id: 3,
      model: "claude-sonnet",
      total_tokens: 500,
      actual_cost: null,
      total_cost: 0.05,
    },
    {
      id: 4,
      input_tokens: 300,
      output_tokens: 200,
      actual_cost: null,
      total_cost: 0.03,
    },
    {
      id: 5,
      model: "   ",
      total_tokens: 100,
      actual_cost: null,
      total_cost: 0.07,
    },
  ],
  "Unknown model"
);

check("three model groups are produced", rows.length, 3);
check("largest token total ranks first", rows[0]?.model, "gpt-4o");
check("tokens merge across records", rows[0]?.totalTokens, 2000);
check("requests merge across records", rows[0]?.requests, 2);
check("cost falls back to total_cost", rows[0]?.cost, 0.30000000000000004);
check("unknown models share one group", rows[1]?.model, "Unknown model");
check("unknown token fallback sums input and output", rows[1]?.totalTokens, 600);
check("share is expressed as a percentage", Number(rows[0]?.share.toFixed(2)), 64.52);

console.log("ties and empty rankings are deterministic");
const tieRows = aggregateModelUsage(
  [
    { id: 1, model: "model-a", total_tokens: 10, actual_cost: 0.1 },
    { id: 2, model: "model-b", total_tokens: 10, actual_cost: 0.2 },
  ],
  "Unknown model"
);
check("higher cost breaks a token tie", tieRows[0]?.model, "model-b");
check("empty records produce an empty ranking", aggregateModelUsage([], "Unknown model"), []);

console.log("dashboard model aggregates retain requests and costs");
const dashboardRows = aggregateDashboardModelUsage(
  [
    { model: "gpt-4o", requests: 14, total_tokens: 24000, actual_cost: 1.25 },
    { model_name: "claude-sonnet", request_count: "7", tokens: "12000", cost: "0.75" },
  ],
  "Unknown model"
);
check("dashboard tokens rank the largest model", dashboardRows[0]?.model, "gpt-4o");
check("dashboard request count is retained", dashboardRows[0]?.requests, 14);
check("dashboard cost is retained", dashboardRows[0]?.cost, 1.25);
check("dashboard aliases are normalized", dashboardRows[1]?.requests, 7);
check("dashboard cost alias is normalized", dashboardRows[1]?.cost, 0.75);
const mixedRows = mergeModelUsageRankings([
  dashboardRows,
  aggregateModelUsage(
    [{ id: 101, model: "gpt-4o", total_tokens: 1000, total_cost: 0.1 }],
    "Unknown model"
  ),
]);
check("dashboard and detail fallback rows merge", mixedRows[0]?.totalTokens, 25000);
check("merged requests keep both sources", mixedRows[0]?.requests, 15);

console.log("offline model snapshots accumulate monotonically for all-time and survive relay wipes");
const syncDay1 = new Date("2026-11-23T10:00:00.000Z");
const syncDay2 = new Date("2026-11-24T10:00:00.000Z");
const syncDay3 = new Date("2026-11-25T10:00:00.000Z");
const wipeTime = new Date("2026-11-24T17:22:00.000Z");

syncAccountModelUsage(
  "acc-model-1",
  "all",
  aggregateDashboardModelUsage(
    [
      { model: "cn:deepseek-v4.1-flash", requests: 100, total_tokens: 1000, actual_cost: 1.0 },
      { model: "gpt-6.1-terra", requests: 20, total_tokens: 400, actual_cost: 0.8 },
    ],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: syncDay1 }
);

// Relay clears data: deepseek drops to 50, gpt-6.1-terra disappears from relay response.
const afterAllReset = syncAccountModelUsage(
  "acc-model-1",
  "all",
  aggregateDashboardModelUsage(
    [{ model: "deepseek-v4.1-flash", requests: 5, total_tokens: 50, actual_cost: 0.05 }],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: wipeTime }
);
check("all-time reset detected", afterAllReset.resetDetected, true);
check("deepseek all-time local stays intact", afterAllReset.rows.find((r) => r.model === "deepseek-v4.1-flash")?.totalTokens, 1000);
check("vanished model stays in local all-time ranking", afterAllReset.rows.find((r) => r.model === "gpt-6.1-terra")?.totalTokens, 400);

// New usage grows on top of preserved history.
const afterGrowth = syncAccountModelUsage(
  "acc-model-1",
  "all",
  aggregateDashboardModelUsage(
    [
      { model: "deepseek-v4.1-flash", requests: 15, total_tokens: 250, actual_cost: 0.25 },
      { model: "gpt-6.1-terra", requests: 2, total_tokens: 100, actual_cost: 0.2 },
    ],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: syncDay3 }
);
check("deepseek grows from re-based server", afterGrowth.rows.find((r) => r.model === "deepseek-v4.1-flash")?.totalTokens, 1200);
check("vanished model grows from 0 baseline", afterGrowth.rows.find((r) => r.model === "gpt-6.1-terra")?.totalTokens, 500);

console.log("30d sliding window preserves pre-reset data via carry-over and expires after 30 days");
syncAccountModelUsage(
  "acc-30d",
  "30d",
  aggregateDashboardModelUsage(
    [{ model: "deepseek-v4.1-flash", requests: 50, total_tokens: 500, actual_cost: 0.5 }],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: syncDay1 }
);
const reset30d = syncAccountModelUsage(
  "acc-30d",
  "30d",
  aggregateDashboardModelUsage(
    [{ model: "deepseek-v4.1-flash", requests: 3, total_tokens: 30, actual_cost: 0.03 }],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: syncDay3, externalResetAt: wipeTime.toISOString() }
);
check("30d preserves pre-reset usage + adds post-reset usage", reset30d.rows[0]?.totalTokens, 530);
check("30d serverTotals reflects only live relay value", reset30d.serverTotals.totalTokens, 30);

// 35 days later, pre-reset carry-over ages out cleanly.
const offline35DaysLater = getAccountOfflineModelRanking(
  "acc-30d",
  "30d",
  "Unknown model",
  new Date("2026-12-30T10:00:00.000Z")
);
check("30d window older than 30 days since last sync is not treated as current", offline35DaysLater, null);

const syncWithinWindowAfterExpiry = syncAccountModelUsage(
  "acc-30d",
  "30d",
  aggregateDashboardModelUsage(
    [{ model: "deepseek-v4.1-flash", requests: 10, total_tokens: 120, actual_cost: 0.12 }],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: new Date("2026-12-30T10:00:00.000Z") }
);
check("expired carry-over clears after 30 days", syncWithinWindowAfterExpiry.rows[0]?.totalTokens, 120);

console.log("offline fallback keeps failed accounts in ranking and guards calendar day for today");
syncAccountModelUsage(
  "acc-offline",
  "30d",
  aggregateDashboardModelUsage(
    [{ model: "gemini-4-hydrogen", requests: 9, total_tokens: 900, actual_cost: 0.09 }],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: syncDay2 }
);
recordModelUsageError("acc-offline", "Session expired");
const offline30d = getAccountOfflineModelRanking("acc-offline", "30d", "Unknown model", syncDay3);
check("offline 30d data remains available", offline30d?.rows[0]?.totalTokens, 900);

syncAccountModelUsage(
  "acc-today",
  "today",
  aggregateDashboardModelUsage(
    [{ model: "gemini-4-hydrogen", requests: 4, total_tokens: 400, actual_cost: 0.04 }],
    "Unknown model"
  ),
  "Unknown model",
  { syncDate: syncDay2 }
);
check("today snapshot available on same day", getAccountOfflineModelRanking("acc-today", "today", "Unknown model", syncDay2)?.rows[0]?.totalTokens, 400);
check("yesterday's today snapshot is not shown on a new day", getAccountOfflineModelRanking("acc-today", "today", "Unknown model", syncDay3), null);

console.log("model snapshot merging keeps larger local history and newest baseline");
const mergedModelSnap = mergeAccountModelSnapshot(
  getAccountModelSnapshot("acc-model-1") ?? undefined,
  {
    accountId: "acc-model-1",
    lastSyncAt: syncDay1.toISOString(),
    resetCount: 0,
    ranges: {
      all: {
        range: "all",
        windowStartDate: "1970-01-01",
        windowEndDate: "2026-11-23",
        lastSyncAt: syncDay1.toISOString(),
        seeded: true,
        models: {
          "deepseek-v4.1-flash": {
            model: "deepseek-v4.1-flash",
            local: { totalTokens: 1000, requests: 100, cost: 1.0 },
            server: { totalTokens: 1000, requests: 100, cost: 1.0 },
          },
        },
      },
    },
  }
);
check("merged all-time local keeps higher value", mergedModelSnap?.ranges.all?.models["deepseek-v4.1-flash"]?.local.totalTokens, 1200);
check("merged all-time server baseline follows newer sync", mergedModelSnap?.ranges.all?.models["deepseek-v4.1-flash"]?.server.totalTokens, 250);
saveAllModelSnapshots({});

console.log("");
if (failures > 0) {
  console.error(`${failures} problem(s) found`);
  process.exitCode = 1;
} else {
  console.log(`${checks}/${checks} model ranking checks passed`);
}
