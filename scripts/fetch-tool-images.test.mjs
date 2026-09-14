import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sniffImageType,
  imageSize,
  extractOgImage,
  downloadImage,
  resolveToolImage,
  snapshotThumbnails,
  isAnimated,
  isPrivateAddress,
  ipv6Bytes,
  resolvePublicTarget,
  safeGet,
} from "./fetch-tool-images.mjs";

function png(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpeg(width, height) {
  // SOI, APP0 (len 16), SOF0 (len 17)
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webpVp8x(width, height) {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

// Every test host resolves to a public documentation-free address unless stated.
const PUBLIC = "93.184.216.34";
const publicLookup = async () => [{ address: PUBLIC, family: 4 }];
const log = () => {};
const ok = (body) => ({ status: 200, headers: {}, body: Buffer.isBuffer(body) ? body : Buffer.from(body) });
const redirect = (location, status = 302) => ({ status, headers: { location }, body: Buffer.alloc(0) });

/** Fake transport: routes by URL and records the pinned address of every call. */
function fakeTransport(routes) {
  const calls = [];
  const transport = async (url, opts) => {
    calls.push({ url, address: opts.address, family: opts.family, maxBytes: opts.maxBytes });
    const route = routes[url];
    if (!route) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    return typeof route === "function" ? route(url, opts) : route;
  };
  return { transport, calls };
}

test("sniffImageType trusts magic bytes, not extensions", () => {
  assert.equal(sniffImageType(png(10, 10)), "png");
  assert.equal(sniffImageType(jpeg(10, 10)), "jpeg");
  assert.equal(sniffImageType(webpVp8x(10, 10)), "webp");
  assert.equal(sniffImageType(Buffer.from("GIF89a......")), "gif");
  assert.equal(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
});

test("imageSize reads PNG, JPEG and WebP headers", () => {
  assert.deepEqual(imageSize(png(1200, 630)), { width: 1200, height: 630 });
  assert.deepEqual(imageSize(jpeg(800, 418)), { width: 800, height: 418 });
  assert.deepEqual(imageSize(webpVp8x(512, 512)), { width: 512, height: 512 });
});

test("extractOgImage prefers og:image and resolves relative URLs", () => {
  const html = `<head>
    <meta name="twitter:image" content="https://cdn.example.com/tw.png">
    <meta content="/og/card.png?v=2&amp;x=1" property="og:image">
  </head>`;
  assert.equal(extractOgImage(html, "https://tool.example.com/app"), "https://tool.example.com/og/card.png?v=2&x=1");
  assert.equal(extractOgImage("<meta name='twitter:image' content='https://cdn.example.com/tw.png'>", "https://a.example"), "https://cdn.example.com/tw.png");
  assert.equal(extractOgImage("<title>none</title>", "https://a.example"), null);
});

test("IPv4: loopback, private, link-local, CGNAT, test nets and reserved are not public", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.10", "198.51.100.7", "203.0.113.9", "240.0.0.1", "255.255.255.255"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "1.1.1.1"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("IPv6: mapped/compatible IPv4, NAT64, 6to4, Teredo, ULA, link-/site-local and multicast are not public", () => {
  for (const ip of [
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::7f00:1", "::127.0.0.1", "::ffff:10.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b::8.8.8.8", "64:ff9b:1::1", "2002:7f00:1::", "2001:0:4136:e378::1", "2001:db8::1",
    "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "fec0::1", "ff02::1", "100::1",
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:82a::200e", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(isPrivateAddress("not-an-ip"), true);
});

test("ipv6Bytes expands :: and dotted tails", () => {
  assert.deepEqual([...ipv6Bytes("::ffff:127.0.0.1")].slice(10), [0xff, 0xff, 127, 0, 0, 1]);
  assert.deepEqual([...ipv6Bytes("2606:4700::1111")].slice(0, 4), [0x26, 0x06, 0x47, 0x00]);
  assert.equal(ipv6Bytes("1::2::3"), null);
  assert.equal(ipv6Bytes("1:2:3:4:5:6:7"), null);
});

test("resolvePublicTarget blocks http, credentials, local names and any private record", async () => {
  await assert.rejects(resolvePublicTarget("http://example.com/a.png", { lookupImpl: publicLookup }), /non-https/);
  await assert.rejects(resolvePublicTarget("https://user:pw@example.com/a.png", { lookupImpl: publicLookup }), /credentials/);
  await assert.rejects(resolvePublicTarget("https://localhost/a.png", { lookupImpl: publicLookup }), /local host/);
  await assert.rejects(resolvePublicTarget("https://[::ffff:7f00:1]/a.png", { lookupImpl: publicLookup }), /private/);
  await assert.rejects(
    resolvePublicTarget("https://mixed.example/a.png", { lookupImpl: async () => [{ address: PUBLIC, family: 4 }, { address: "10.0.0.5", family: 4 }] }),
    /private/
  );
  assert.deepEqual(await resolvePublicTarget("https://tool.example.com/a.png", { lookupImpl: publicLookup }), { host: "tool.example.com", address: PUBLIC, family: 4 });
});

test("safeGet pins every connection to the address it validated (no second lookup)", async () => {
  let lookups = 0;
  const lookupImpl = async () => {
    lookups++;
    return [{ address: PUBLIC, family: 4 }];
  };
  const { transport, calls } = fakeTransport({ "https://tool.example.com/logo.png": ok(png(300, 300)) });
  const res = await safeGet("https://tool.example.com/logo.png", { transport, lookupImpl, maxBytes: 1024 });
  assert.equal(res.status, 200);
  assert.equal(lookups, 1);
  assert.deepEqual(calls, [{ url: "https://tool.example.com/logo.png", address: PUBLIC, family: 4, maxBytes: 1024 }]);
});

test("safeGet validates every redirect hop", async () => {
  await assert.rejects(
    safeGet("https://tool.example.com/a.png", { transport: fakeTransport({ "https://tool.example.com/a.png": redirect("http://cdn.example.com/a.png") }).transport, lookupImpl: publicLookup }),
    /non-https/
  );
  await assert.rejects(
    safeGet("https://tool.example.com/a.png", { transport: fakeTransport({ "https://tool.example.com/a.png": redirect("https://[fd00::1]/meta") }).transport, lookupImpl: publicLookup }),
    /private/
  );
  const loop = { transport: async (url) => redirect(url) };
  await assert.rejects(safeGet("https://tool.example.com/loop", { ...loop, lookupImpl: publicLookup }), /too many redirects/);

  const { transport, calls } = fakeTransport({
    "https://tool.example.com/start": redirect("/final.png", 301),
    "https://tool.example.com/final.png": ok(png(300, 300)),
  });
  const res = await safeGet("https://tool.example.com/start", { transport, lookupImpl: publicLookup });
  assert.equal(res.finalUrl, "https://tool.example.com/final.png");
  assert.deepEqual(calls.map((c) => c.url), ["https://tool.example.com/start", "https://tool.example.com/final.png"]);
});

test("downloadImage rejects tiny, non-image and oversized responses", async () => {
  const { transport } = fakeTransport({
    "https://x.example/a.png": ok(png(32, 32)),
    "https://x.example/a.svg": ok("<svg/>".padEnd(40)),
    "https://x.example/big.png": ok(Buffer.alloc(6 * 1024 * 1024)),
    "https://x.example/ok.png": ok(png(1200, 630)),
  });
  const opts = { transport, lookupImpl: publicLookup, log };
  assert.equal(await downloadImage("https://x.example/a.png", opts), null);
  assert.equal(await downloadImage("https://x.example/a.svg", opts), null);
  assert.equal(await downloadImage("https://x.example/big.png", opts), null);
  const img = await downloadImage("https://x.example/ok.png", opts);
  assert.equal(img.type, "png");
  assert.equal(img.width, 1200);
});

test("animated GIFs are flattened to their first frame, animated WebP is skipped", async () => {
  // GIF header + two Graphic Control Extensions = two frames
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(7), Buffer.from([0x21, 0xf9, 0x04, 0, 0, 0, 0, 0]), Buffer.alloc(10), Buffer.from([0x21, 0xf9, 0x04, 0, 0, 0, 0, 0])]);
  assert.equal(isAnimated(gif), true);
  assert.equal(isAnimated(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(7), Buffer.from([0x21, 0xf9, 0x04])])), false);
  const animatedWebp = webpVp8x(512, 512);
  animatedWebp[20] = 0x02;
  assert.equal(isAnimated(animatedWebp), true);
  assert.equal(isAnimated(webpVp8x(512, 512)), false);

  const { transport } = fakeTransport({ "https://x.example/logo.gif": ok(gif), "https://x.example/a.webp": ok(animatedWebp) });
  const flattened = await downloadImage("https://x.example/logo.gif", { transport, lookupImpl: publicLookup, firstFrame: () => png(400, 400), log });
  assert.equal(flattened.type, "png");
  assert.equal(flattened.width, 400);
  assert.equal(await downloadImage("https://x.example/a.webp", { transport, lookupImpl: publicLookup, log }), null);
});

test("resolveToolImage falls back routine → PH thumbnail → og:image", async () => {
  const { transport } = fakeTransport({
    "https://routine.example/broken.png": { status: 404, headers: {}, body: Buffer.from("nope") },
    "https://ph-files.imgix.net/t.png": ok("not an image at all"),
    "https://tool.example.com": ok('<meta property="og:image" content="https://tool.example.com/og.jpg">'),
    "https://tool.example.com/og.jpg": ok(jpeg(1200, 630)),
  });
  const snapshot = { days: [{ posts: [{ slug: "tool", thumbnail: "https://ph-files.imgix.net/t.png" }] }] };
  const img = await resolveToolImage(
    { imageUrl: "https://routine.example/broken.png", slug: "tool", website: "https://tool.example.com" },
    { thumbnails: snapshotThumbnails(snapshot), transport, lookupImpl: publicLookup, log }
  );
  assert.equal(img.from, "official og:image");
  assert.equal(img.type, "jpeg");
});

test("resolveToolImage never fetches an http image_url", async () => {
  const { transport, calls } = fakeTransport({ "http://insecure.example/logo.png": ok(png(400, 400)) });
  const img = await resolveToolImage({ imageUrl: "http://insecure.example/logo.png", slug: "x", website: null }, { transport, lookupImpl: publicLookup, log });
  assert.equal(img, null);
  assert.equal(calls.length, 0);
});

test("resolveToolImage returns null when nothing usable exists", async () => {
  const { transport } = fakeTransport({ "https://nothing.example": ok("<html></html>") });
  const img = await resolveToolImage({ imageUrl: null, slug: "x", website: "https://nothing.example" }, { transport, lookupImpl: publicLookup, log });
  assert.equal(img, null);
});
