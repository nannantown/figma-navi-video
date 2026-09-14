/**
 * Best-effort logo / screenshot per tool for the video cards.
 *
 * Candidates, first hit wins:
 *   1. tools[i].imageUrl from the routine (og:image or logo on the official site)
 *   2. Product Hunt API thumbnail from data/product-hunt-daily.json (API mode only)
 *   3. og:image / twitter:image of the tool's official website
 * Accepted: PNG / JPEG / WebP / GIF, verified by magic bytes, ≥ 120 px on both
 * sides, ≤ 5 MB. Anything else → the card is rendered text-only.
 *
 * Input/Output: output/trending-data.json (tools[i].image = "tools/tool-N.ext",
 * a path under public/ for Remotion's staticFile()).
 *
 * Never fails the pipeline: every error is logged and skipped.
 * SKIP_TOOL_IMAGES=1 disables downloads (offline runs).
 */

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const imagesDir = join(rootDir, "public", "tools");
const snapshotPath = join(rootDir, "data", "product-hunt-daily.json");

export const MAX_BYTES = 5 * 1024 * 1024;
export const MIN_SIDE = 120;
const USER_AGENT = "Mozilla/5.0 (compatible; sns-hub-figma-navi-video/1.0; +https://github.com/nannantown/figma-navi-video)";

/** @returns {"png"|"jpeg"|"webp"|"gif"|null} */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "gif";
  return null;
}

/** Pixel size from the file header, or null when it cannot be read. */
export function imageSize(buf, type = sniffImageType(buf)) {
  try {
    if (type === "png") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type === "gif") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (type === "webp") {
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8X") {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (chunk === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      return null;
    }
    if (type === "jpeg") {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++;
          continue;
        }
        const marker = buf[off + 1];
        if (marker === 0xff) {
          off++; // fill byte
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2;
          continue;
        }
        const len = buf.readUInt16BE(off + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + len;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Animated GIF / WebP would play at the browser's own pace instead of in sync
 * with the rendered frames, so they are flattened (GIF) or skipped (WebP).
 */
export function isAnimated(buf, type = sniffImageType(buf)) {
  if (type === "gif") {
    if (buf.includes("NETSCAPE2.0") || buf.includes("ANIMEXTS1.0")) return true;
    let gce = 0;
    for (let i = 0; i + 2 < buf.length; i++) {
      if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04 && ++gce > 1) return true;
    }
    return false;
  }
  if (type === "webp") {
    // Animated WebP always carries a VP8X header with the animation flag (0x02).
    return buf.toString("ascii", 12, 16) === "VP8X" && (buf[20] & 0x02) !== 0;
  }
  return false;
}

/** First frame of an animated GIF as PNG via ffmpeg (installed by daily-video.yml). */
export function ffmpegFirstFrame(buf) {
  const dir = mkdtempSync(join(tmpdir(), "tool-img-"));
  try {
    const inPath = join(dir, "in.gif");
    const outPath = join(dir, "out.png");
    writeFileSync(inPath, buf);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", inPath, "-frames:v", "1", outPath], { stdio: "ignore", timeout: 20000 });
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function decodeAttr(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** og:image → twitter:image, resolved against the page URL. */
export function extractOgImage(html, pageUrl) {
  if (!html) return null;
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"];
  const found = {};
  for (const tag of metas) {
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (key && content && wanted.includes(key.toLowerCase()) && !found[key.toLowerCase()]) {
      found[key.toLowerCase()] = decodeAttr(content.trim());
    }
  }
  for (const key of wanted) {
    if (!found[key]) continue;
    try {
      const abs = new URL(found[key], pageUrl);
      if (abs.protocol === "https:" || abs.protocol === "http:") return abs.toString();
    } catch {
      // ignore malformed URLs
    }
  }
  return null;
}

async function fetchWithTimeout(url, fetchImpl, accept) {
  return fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
}

/** @returns {Promise<{buf: Buffer, type: string, width: number, height: number} | null>} */
export async function downloadImage(url, { fetchImpl = fetch, log = console.log, firstFrame = ffmpegFirstFrame } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetchWithTimeout(url, fetchImpl, "image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1");
    if (!res.ok) {
      log(`    skip ${url}: HTTP ${res.status}`);
      return null;
    }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) {
      log(`    skip ${url}: ${declared} bytes > ${MAX_BYTES}`);
      return null;
    }
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      log(`    skip ${url}: ${buf.length} bytes > ${MAX_BYTES}`);
      return null;
    }
    let type = sniffImageType(buf);
    if (!type) {
      log(`    skip ${url}: not PNG/JPEG/WebP/GIF`);
      return null;
    }
    if (isAnimated(buf, type)) {
      if (type !== "gif") {
        log(`    skip ${url}: animated ${type}`);
        return null;
      }
      try {
        buf = firstFrame(buf);
        type = sniffImageType(buf);
      } catch (err) {
        log(`    skip ${url}: animated gif, first-frame extraction failed (${err.message})`);
        return null;
      }
      if (type !== "png") {
        log(`    skip ${url}: animated gif, first frame is not a PNG`);
        return null;
      }
    }
    const size = imageSize(buf, type);
    if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) {
      log(`    skip ${url}: too small or unreadable (${size ? `${size.width}x${size.height}` : "?"})`);
      return null;
    }
    return { buf, type, ...size };
  } catch (err) {
    log(`    skip ${url}: ${err.message}`);
    return null;
  }
}

export async function findOgImageUrl(website, { fetchImpl = fetch, log = console.log } = {}) {
  if (!website) return null;
  try {
    const res = await fetchWithTimeout(website, fetchImpl, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
    if (!res.ok) {
      log(`    og:image lookup ${website}: HTTP ${res.status}`);
      return null;
    }
    const html = (await res.text()).slice(0, 400_000);
    return extractOgImage(html, res.url || website);
  } catch (err) {
    log(`    og:image lookup ${website}: ${err.message}`);
    return null;
  }
}

export function snapshotThumbnails(snapshot) {
  const map = new Map();
  for (const day of snapshot?.days || []) {
    for (const p of day.posts || []) {
      if (p.slug && p.thumbnail && !map.has(p.slug)) map.set(p.slug, p.thumbnail);
    }
  }
  return map;
}

export async function resolveToolImage(tool, { thumbnails = new Map(), fetchImpl = fetch, log = console.log } = {}) {
  const tried = new Set();
  const attempt = async (url, label) => {
    if (!url || tried.has(url)) return null;
    tried.add(url);
    log(`    try ${label}: ${url}`);
    const img = await downloadImage(url, { fetchImpl, log });
    return img ? { ...img, from: label, url } : null;
  };

  return (
    (await attempt(tool.imageUrl, "routine image_url")) ||
    (await attempt(thumbnails.get(tool.slug), "Product Hunt thumbnail")) ||
    (await attempt(await findOgImageUrl(tool.website, { fetchImpl, log }), "official og:image"))
  );
}

async function main() {
  const dataPath = join(outputDir, "trending-data.json");
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const tools = data.tools || [];

  rmSync(imagesDir, { recursive: true, force: true });
  if (process.env.SKIP_TOOL_IMAGES === "1") {
    console.log("fetch-tool-images: SKIP_TOOL_IMAGES=1 — cards will be text-only.");
    for (const t of tools) t.image = null;
    writeFileSync(dataPath, JSON.stringify(data, null, 2));
    return;
  }
  mkdirSync(imagesDir, { recursive: true });

  let snapshot = null;
  if (existsSync(snapshotPath)) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));
    } catch (err) {
      console.warn(`fetch-tool-images: unreadable snapshot (${err.message})`);
    }
  }
  const thumbnails = snapshotThumbnails(snapshot);

  let found = 0;
  for (const tool of tools) {
    console.log(`  [${tool.rank}] ${tool.name}`);
    const img = await resolveToolImage(tool, { thumbnails });
    if (!img) {
      tool.image = null;
      console.log("    → no usable image, text-only card");
      continue;
    }
    const ext = img.type === "jpeg" ? "jpg" : img.type;
    const file = `tool-${tool.rank}.${ext}`;
    writeFileSync(join(imagesDir, file), img.buf);
    tool.image = `tools/${file}`;
    tool.imageSize = { width: img.width, height: img.height };
    found++;
    console.log(`    → ${tool.image} (${img.width}x${img.height}, from ${img.from})`);
  }

  writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`fetch-tool-images: ${found}/${tools.length} tools have an image`);
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) {
  main().catch((err) => {
    // Non-blocking by design: images are decoration.
    console.error(`fetch-tool-images failed (non-blocking): ${err.message}`);
  });
}
