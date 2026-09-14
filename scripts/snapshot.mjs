/**
 * Load the Product Hunt snapshot committed by fetch-product-hunt.yml
 * (data/product-hunt-daily.json) for validation cross-checks.
 * PH_SNAPSHOT_PATH overrides the location (tests / dry runs).
 */

import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";

export const DEFAULT_SNAPSHOT_PATH = "data/product-hunt-daily.json";

/** @returns {{ snapshot: object | null, path: string, error: string | null }} */
export function loadSnapshot(rootDir, env = process.env) {
  const rel = env.PH_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
  const path = isAbsolute(rel) ? rel : join(rootDir, rel);
  if (!existsSync(path)) return { snapshot: null, path, error: null };
  try {
    return { snapshot: JSON.parse(readFileSync(path, "utf-8")), path, error: null };
  } catch (err) {
    return { snapshot: null, path, error: `unreadable snapshot ${path}: ${err.message}` };
  }
}
