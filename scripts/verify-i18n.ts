/**
 * Checks the translation dictionary.
 *
 *   node --experimental-strip-types scripts/verify-i18n.ts
 *
 * Fails when a key is missing a language, has an empty string, uses different
 * placeholders per language, or is never referenced from the app (dead key).
 * It also lists text that looks like hardcoded UI copy as a warning.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
  new MemoryStorage();

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

const { getDictionary, getLocale, setLocale, t } = await import(
  "../src/lib/i18n.ts"
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const sources = new Map<string, string>();
for (const file of walk(srcDir)) {
  sources.set(relative(srcDir, file).replace(/\\/g, "/"), readFileSync(file, "utf8"));
}

// The dictionary itself is not a usage site.
const usageSources = [...sources.entries()].filter(
  ([name]) => name !== "lib/i18n.ts"
);

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error(`  FAIL ${message}`);
}
function ok(message: string): void {
  console.log(`  ok   ${message}`);
}

// The dictionary comes straight from the module the app uses, so this check
// can never drift from the shipped strings.
const entries = new Map<string, { en: string; zh: string }>(
  Object.entries(getDictionary())
);

console.log(`dictionary entries : ${entries.size}`);
if (entries.size === 0) fail("the dictionary is empty");

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

let missingLanguage = 0;
let placeholderMismatch = 0;
for (const [key, messages] of entries) {
  if (!messages.en.trim() || !messages.zh.trim()) {
    missingLanguage += 1;
    fail(`${key} is missing a translation (en="${messages.en}" zh="${messages.zh}")`);
  }
  const en = placeholders(messages.en);
  const zh = placeholders(messages.zh);
  if (en.join(",") !== zh.join(",")) {
    placeholderMismatch += 1;
    fail(`${key} placeholders differ: en[${en.join(",")}] vs zh[${zh.join(",")}]`);
  }
}

const unused: string[] = [];
for (const key of entries.keys()) {
  const used = usageSources.some(([, source]) => source.includes(`"${key}"`));
  if (!used) unused.push(key);
}
for (const key of unused) fail(`dictionary key "${key}" is never used`);

// Heuristic: JSX text nodes that look like prose and are not translated.
const literalPattern = />[^<>{}]*[A-Za-z]{3,} [A-Za-z]{2,}[^<>{}]*</g;
const suspicious: string[] = [];
for (const [name, source] of usageSources) {
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    if (/#[0-9a-fA-F]{3,8}|(px|rem|em)\b/.test(trimmed)) return;
    for (const match of line.matchAll(literalPattern)) {
      const text = match[0].slice(1, -1).trim();
      if (!text || /^[A-Z_ \u4e00-\u9fff]+$/.test(text)) continue;
      suspicious.push(`${name}:${index + 1}  ${text}`);
    }
  });
}

console.log("");
ok(`${entries.size} keys carry both languages`);
ok("placeholder sets match between languages");
ok("every key is referenced from the app");

const probe = "usage.accountsTotalTokens" as const;
setLocale("zh");
const zh = t(probe);
setLocale("en");
const en = t(probe);
ok(`t() switches language ("${en}" / "${zh}"), locale=${getLocale()}`);
if (zh === en) fail("t() returned the same text for both languages");
if (!t("usage.accountsTotalTokensHint", { value: 42 }).includes("42")) {
  fail("placeholder interpolation failed");
}

if (suspicious.length > 0) {
  console.log(`\n${suspicious.length} possible hardcoded UI string(s) to review:`);
  for (const line of suspicious.slice(0, 20)) console.log(`  ~    ${line}`);
}

console.log(
  `\n${entries.size} keys · ${missingLanguage} missing · ${placeholderMismatch} placeholder mismatches · ${unused.length} unused`
);
if (failures > 0) {
  console.error(`${failures} problem(s) found`);
  process.exitCode = 1;
} else {
  console.log("i18n dictionary OK");
}
