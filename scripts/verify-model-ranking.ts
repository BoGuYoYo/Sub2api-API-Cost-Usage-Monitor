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

console.log("");
if (failures > 0) {
  console.error(`${failures} problem(s) found`);
  process.exitCode = 1;
} else {
  console.log(`${checks}/${checks} model ranking checks passed`);
}
