/**
 * Validate data/enriched-ai-tools.json with exactly the rules the pipeline
 * uses. The Claude Routine must run this before committing.
 *
 * Usage:
 *   node scripts/validate-enriched.mjs                       # data/enriched-ai-tools.json, date must be today JST
 *   node scripts/validate-enriched.mjs --file=path.json --no-date-check
 *
 * Exit code 0 = valid (warnings allowed), 1 = invalid.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { parseEnrichedText, validateEnriched, todayJst } from "./enriched-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const fileArg = process.argv.find((a) => a.startsWith("--file="));
const rel = fileArg ? fileArg.slice("--file=".length) : "data/enriched-ai-tools.json";
const path = isAbsolute(rel) ? rel : join(rootDir, rel);
const checkDate = !process.argv.includes("--no-date-check");

if (!existsSync(path)) {
  console.error(`NG: ${path} not found`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseEnrichedText(readFileSync(path, "utf-8"));
} catch (err) {
  console.error(`NG: ${err.message}`);
  process.exit(1);
}
if (parsed.repaired) {
  console.error("NG: JSON only parses after auto-repair (unescaped \" inside a string). Fix the file.");
  process.exit(1);
}

const { errors, warnings } = validateEnriched(parsed.data, { today: todayJst(), checkDate });
for (const w of warnings) console.log(`WARN: ${w}`);
for (const e of errors) console.error(`NG: ${e}`);
if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) — fix before committing.`);
  process.exit(1);
}
console.log(`OK: ${rel} is valid (${warnings.length} warning(s))`);
