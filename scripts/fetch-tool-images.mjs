/**
 * Best-effort logo / screenshot per tool for the video cards.
 *
 * Candidates, first hit wins:
 *   1. tools[i].imageUrl from the routine (og:image or logo on the official site)
 *   2. Product Hunt API thumbnail from data/product-hunt-daily.json (API mode only)
 *   3. og:image / twitter:image of the tool's official website
 * Accepted: PNG / JPEG / WebP / GIF, verified by magic bytes, ≥ 120 px on both
 * sides, ≤ 5 MB. Animated GIFs are flattened to their first frame, animated
 * WebP is skipped. Anything else → the card is rendered text-only.
 *
 * Network safety (the URLs come from the routine and third-party pages):
 * https only, no credentials, every hop (including redirects, max 5) must
 * resolve only to public addresses, and the connection is pinned to the
 * address that was checked (no second DNS lookup → no rebinding window).
 * Bodies are read with a hard size cap.
 *
 * Input/Output: output/trending-data.json (tools[i].image = "tools/tool-N.ext",
 * a path under public/ for Remotion's staticFile()).
 *
 * Never fails the pipeline: every error is logged and skipped.
 * SKIP_TOOL_IMAGES=1 disables downloads (offline runs).
 *
 * 【一次資料】Node.js https.request / net.connect `lookup` option (custom resolver,
 *   called with { all: true } when autoSelectFamily is on):
 *   https://nodejs.org/docs/latest-v22.x/api/net.html#socketconnectoptions-connectlistener (2026-09-14)
 *   Special-purpose address registries: https://www.iana.org/assignments/iana-ipv4-special-registry/ ,
 *   https://www.iana.org/assignments/iana-ipv6-special-registry/ (2026-09-14)
 */

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const imagesDir = join(rootDir, "public", "tools");
const snapshotPath = join(rootDir, "data", "product-hunt-daily.json");

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_HTML_BYTES = 1024 * 1024;
export const MIN_SIDE = 120;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 12000; // one DNS lookup or one request, wall clock
export const PER_TOOL_BUDGET_MS = 30000; // all attempts for one tool
export const STEP_BUDGET_MS = 90000; // all tools (pipeline.mjs also kills the step at IMAGE_STEP_KILL_MS)
const USER_AGENT = "Mozilla/5.0 (compatible; sns-hub-figma-navi-video/1.0; +https://github.com/nannantown/figma-navi-video)";

// --- Image format ----------------------------------------------------------

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

// --- Address checks ----------------------------------------------------------

function ipv4Octets(ip) {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

export function isPrivateIPv4(ip) {
  const o = ipv4Octets(ip);
  if (!o) return true;
  const [a, b, c] = o;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast + reserved + broadcast
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) // TEST-NET-3
  );
}

/** 16 bytes of an IPv6 address (handles "::" and a dotted IPv4 tail), or null. */
export function ipv6Bytes(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  let tail = [];
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = ipv4Octets(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = [((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)];
    s = s.slice(0, lastColon + 1) + "x";
  }
  const [head, rest] = s.split("::");
  if (s.split("::").length > 2) return null;
  const toGroups = (part) => (part ? part.split(":").filter((g) => g !== "") : []);
  let left = toGroups(head);
  let right = rest === undefined ? [] : toGroups(rest);
  const replaceX = (groups) => groups.flatMap((g) => (g === "x" ? tail : [g]));
  left = replaceX(left);
  right = replaceX(right);
  const missing = 8 - left.length - right.length;
  if (rest === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(rest === undefined ? 0 : missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g, 16);
    bytes[i * 2] = v >> 8;
    bytes[i * 2 + 1] = v & 0xff;
  });
  return bytes;
}

export function isPrivateIPv6(ip) {
  const b = ipv6Bytes(ip);
  if (!b) return true;
  // IANA IPv6 Address Space: only 2000::/3 is Global Unicast. Everything else is
  // never an image host — ::/8 (unspecified, loopback, IPv4-compatible, -mapped
  // ::ffff:a.b.c.d and -translated ::ffff:0:a.b.c.d), 64:ff9b::/96 and
  // 64:ff9b:1::/48 NAT64 (they reach IPv4 addresses, private ones included),
  // 100::/64 discard, 5f00::/16 SRv6, fc00::/7, fe80::/10, fec0::/10, ff00::/8.
  if ((b[0] & 0xe0) !== 0x20) return true;
  // Special-purpose blocks inside 2000::/3 (IANA IPv6 Special-Purpose Address Registry).
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2] & 0xfe) === 0x00) return true; // 2001::/23 IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 2002::/16 6to4 (embeds an IPv4 address)
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0x00) return true; // 3fff::/20 documentation
  return false;
}

/** true for any address that is not clearly public; unparsable input counts as private. */
export function isPrivateAddress(ip) {
  const v = isIP(String(ip ?? "").replace(/^\[|\]$/g, "").split("%")[0]);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true;
}

/**
 * Validate a URL and resolve its host to one public address to connect to.
 * @returns {Promise<{ host: string, address: string, family: 4 | 6 }>}
 */
export async function resolvePublicTarget(url, { lookupImpl = dnsLookup } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid URL ${url}`);
  }
  if (u.protocol !== "https:") throw new Error(`blocked non-https URL ${u.protocol}//${u.host}`);
  if (u.username || u.password) throw new Error("blocked URL with credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`blocked local host ${host}`);
  }
  const literal = isIP(host);
  const records = literal ? [{ address: host, family: literal }] : await lookupImpl(host, { all: true, verbatim: true });
  if (!records || records.length === 0) throw new Error(`no address for ${host}`);
  if (records.some((r) => isPrivateAddress(r.address))) throw new Error(`blocked private address for ${host}`);
  return { host, address: records[0].address, family: records[0].family === 6 ? 6 : 4 };
}

// --- Transport (connection pinned to the checked address) --------------------

/**
 * GET over https with the socket connected to `address` (no second lookup).
 * Redirect responses resolve without a body; others are read up to maxBytes.
 * `timeoutMs` bounds the whole exchange (wall clock), not just idle gaps, so a
 * server that trickles one byte at a time cannot hold the job open.
 * `request` is injectable for tests (http.request against a local server).
 * @returns {Promise<{ status: number, headers: { location?: string }, body: Buffer }>}
 */
export function httpsTransport(url, { address, family, accept, maxBytes, timeoutMs = TIMEOUT_MS, request = https.request }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline = null;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };
    const pinnedLookup = (_hostname, options, callback) => {
      if (options && options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const req = request(
      url,
      {
        method: "GET",
        headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Encoding": "identity" },
        lookup: pinnedLookup,
      },
      (res) => {
        const status = res.statusCode || 0;
        const headers = { location: res.headers.location };
        if (status >= 300 && status < 400) {
          res.resume();
          settle(resolve, { status, headers, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers["content-length"] || 0);
        if (declared > maxBytes) {
          settle(reject, new Error(`${declared} bytes > ${maxBytes}`));
          req.destroy();
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            req.destroy(new Error(`body exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => settle(resolve, { status, headers, body: Buffer.concat(chunks) }));
        res.on("error", (err) => settle(reject, err));
      }
    );
    deadline = setTimeout(() => {
      const err = new Error(`timeout after ${timeoutMs} ms`);
      settle(reject, err);
      req.destroy(err);
    }, timeoutMs);
    req.on("error", (err) => settle(reject, err));
    req.end();
  });
}

/** Reject when `promise` has not settled within `ms` (the work itself is not cancelled). */
function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET with validated, bounded redirects; every hop re-checks https + public address.
 * `deadlineAt` (epoch ms) is a budget shared by all hops: each DNS lookup and
 * request gets at most what is left, and no new hop starts once it is spent.
 */
export async function safeGet(url, { transport = httpsTransport, lookupImpl = dnsLookup, accept = "*/*", maxBytes = MAX_BYTES, deadlineAt = Infinity, now = Date.now } = {}) {
  const budgetLeft = () => {
    const left = deadlineAt - now();
    if (left <= 0) throw new Error("time budget exhausted");
    return Math.min(TIMEOUT_MS, left);
  };
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const lookupMs = budgetLeft();
    const target = await withTimeout(resolvePublicTarget(current, { lookupImpl }), lookupMs, "address lookup");
    const res = await transport(current, { address: target.address, family: target.family, accept, maxBytes, timeoutMs: budgetLeft() });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (!res.headers?.location) throw new Error(`redirect without location from ${current}`);
      current = new URL(res.headers.location, current).toString();
      continue;
    }
    if (res.body && res.body.length > maxBytes) throw new Error(`body exceeds ${maxBytes} bytes`);
    return { status: res.status, body: res.body || Buffer.alloc(0), finalUrl: current, address: target.address };
  }
  throw new Error(`too many redirects from ${url}`);
}

// --- Image resolution ---------------------------------------------------------

/** @returns {Promise<{buf: Buffer, type: string, width: number, height: number} | null>} */
export async function downloadImage(url, { transport = httpsTransport, lookupImpl = dnsLookup, log = console.log, firstFrame = ffmpegFirstFrame, deadlineAt = Infinity, now = Date.now } = {}) {
  if (!url) return null;
  try {
    const res = await safeGet(url, { transport, lookupImpl, accept: "image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1", maxBytes: MAX_BYTES, deadlineAt, now });
    if (res.status !== 200) {
      log(`    skip ${url}: HTTP ${res.status}`);
      return null;
    }
    let buf = res.body;
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

export async function findOgImageUrl(website, { transport = httpsTransport, lookupImpl = dnsLookup, log = console.log, deadlineAt = Infinity, now = Date.now } = {}) {
  if (!website) return null;
  try {
    const res = await safeGet(website, { transport, lookupImpl, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", maxBytes: MAX_HTML_BYTES, deadlineAt, now });
    if (res.status !== 200) {
      log(`    og:image lookup ${website}: HTTP ${res.status}`);
      return null;
    }
    return extractOgImage(res.body.toString("utf-8"), res.finalUrl);
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

export async function resolveToolImage(
  tool,
  { thumbnails = new Map(), transport = httpsTransport, lookupImpl = dnsLookup, log = console.log, firstFrame = ffmpegFirstFrame, deadlineAt = Infinity, now = Date.now } = {}
) {
  const tried = new Set();
  const attempt = async (url, label) => {
    if (!url || tried.has(url)) return null;
    if (now() >= deadlineAt) {
      log(`    skip ${label}: time budget exhausted`);
      return null;
    }
    tried.add(url);
    log(`    try ${label}: ${url}`);
    const img = await downloadImage(url, { transport, lookupImpl, log, firstFrame, deadlineAt, now });
    return img ? { ...img, from: label, url } : null;
  };

  return (
    (await attempt(tool.imageUrl, "routine image_url")) ||
    (await attempt(thumbnails.get(tool.slug), "Product Hunt thumbnail")) ||
    (now() < deadlineAt ? await attempt(await findOgImageUrl(tool.website, { transport, lookupImpl, log, deadlineAt, now }), "official og:image") : null)
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

  // Images are decoration: the whole step gets a fixed budget, and one slow
  // site cannot use up the time of the tools after it.
  const stepDeadline = Date.now() + STEP_BUDGET_MS;
  let found = 0;
  for (const tool of tools) {
    console.log(`  [${tool.rank}] ${tool.name}`);
    const deadlineAt = Math.min(stepDeadline, Date.now() + PER_TOOL_BUDGET_MS);
    const img = Date.now() < stepDeadline ? await resolveToolImage(tool, { thumbnails, deadlineAt }) : null;
    if (!img) {
      tool.image = null;
      console.log(Date.now() < stepDeadline ? "    → no usable image, text-only card" : "    → image step time budget used up, text-only card");
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
