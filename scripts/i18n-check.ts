/**
 * Static i18n coverage check (BRIEF A2.4: UI copy lives ONLY in
 * messages/*.json). Scans app/ and components/ for next-intl translator
 * declarations and the keys they are called with, then verifies every
 * key exists in each locale that should carry the namespace.
 *
 *   pnpm exec tsx scripts/i18n-check.ts            # report, exit 1 on gaps
 *   pnpm exec tsx scripts/i18n-check.ts --json     # machine-readable
 *
 * Heuristic by design: dynamic keys (template literals) are reported as
 * "dynamic" and checked by prefix only. No DB needed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "components"];
const LOCALES: Record<string, string[]> = {
  "pt-PT": ["common", "guest", "cockpit", "display", "console"],
  // The guest app is bilingual (B6); staff surfaces are pt-PT only.
  en: ["common", "guest"],
};

interface Usage {
  file: string;
  line: number;
  key: string;
  dynamic: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(tsx?|mdx?)$/.test(entry) && !/\.(test|stories)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function flatten(obj: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flatten(v, key, out);
      else out.add(key);
    }
  }
  return out;
}

function loadLocale(locale: string): Set<string> {
  const dir = path.join(ROOT, "messages", locale);
  const keys = new Set<string>();
  for (const ns of LOCALES[locale] ?? []) {
    const file = path.join(dir, `${ns}.json`);
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // Missing namespace file: every key in it is missing.
    }
    for (const k of flatten(parsed)) keys.add(`${ns}.${k}`);
  }
  return keys;
}

/**
 * Finds `const X = useTranslations("ns")` / `await getTranslations("ns")`
 * (also `getTranslations({ locale, namespace: "ns" })`) and every
 * `X("key")` / `X(\`prefix.${…}\`)` call that follows in the file.
 */
function scanFile(file: string): Usage[] {
  const src = readFileSync(file, "utf8");
  const usages: Usage[] = [];
  const declRe =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|\{[^}]*namespace:\s*"([^"]*)"[^}]*\})?\s*\)/g;
  const decls: Array<{ name: string; ns: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src)) !== null) {
    decls.push({ name: m[1]!, ns: m[2] ?? m[3] ?? "", index: m.index });
  }
  if (decls.length === 0) return usages;

  const lineOf = (index: number) => src.slice(0, index).split("\n").length;
  const names = [...new Set(decls.map((d) => d.name))];

  for (const name of names) {
    const callRe = new RegExp(
      `(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?:\\.rich|\\.raw|\\.markup)?\\(\\s*(?:"([^"]+)"|'([^']+)'|\`([^\`]*)\`)`,
      "g",
    );
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(src)) !== null) {
      // Scope: the nearest declaration of this name ABOVE the call — files
      // with several components each redeclare `t` for their namespace.
      const decl = decls
        .filter((d) => d.name === name && d.index < c!.index)
        .at(-1);
      if (!decl) continue;
      const prefix = decl.ns ? `${decl.ns}.` : "";
      const literal = c[1] ?? c[2];
      const template = c[3];
      if (literal !== undefined) {
        usages.push({ file, line: lineOf(c.index), key: prefix + literal, dynamic: false });
      } else if (template !== undefined) {
        const staticPrefix = template.split("${")[0] ?? "";
        usages.push({
          file,
          line: lineOf(c.index),
          key: prefix + staticPrefix,
          dynamic: true,
        });
      }
    }
  }
  return usages;
}

function namespaceOf(key: string): string {
  return key.split(".")[0] ?? "";
}

function main() {
  const files = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const usages = files.flatMap(scanFile);
  const json = process.argv.includes("--json");

  const report: Record<string, { missing: Usage[]; dynamicUnmatched: Usage[] }> = {};
  let failures = 0;

  for (const locale of Object.keys(LOCALES)) {
    const keys = loadLocale(locale);
    const namespaces = new Set(LOCALES[locale]);
    const missing: Usage[] = [];
    const dynamicUnmatched: Usage[] = [];
    const seen = new Set<string>();
    for (const u of usages) {
      if (!namespaces.has(namespaceOf(u.key))) continue;
      const id = `${u.key}|${u.dynamic}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (u.dynamic) {
        const hasPrefix = [...keys].some((k) => k.startsWith(u.key));
        if (!hasPrefix) dynamicUnmatched.push(u);
      } else if (!keys.has(u.key)) {
        missing.push(u);
      }
    }
    failures += missing.length + dynamicUnmatched.length;
    report[locale] = { missing, dynamicUnmatched };
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const [locale, r] of Object.entries(report)) {
      console.log(`[i18n] ${locale}: ${r.missing.length} missing, ${r.dynamicUnmatched.length} dynamic prefixes unmatched`);
      for (const u of r.missing) {
        console.log(`  missing  ${u.key}  (${path.relative(ROOT, u.file)}:${u.line})`);
      }
      for (const u of r.dynamicUnmatched) {
        console.log(`  dynamic  ${u.key}*  (${path.relative(ROOT, u.file)}:${u.line})`);
      }
    }
    console.log(`[i18n] scanned ${files.length} files, ${usages.length} usages`);
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();
