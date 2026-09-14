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
  assertPublicHttps,
  safeFetch,
  readBodyLimited,
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

// Every test host resolves to a public documentation address unless stated.
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const log = () => {};
const respond = (buf, headers = {}) => new Response(buf, { status: 200, headers });
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });

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

test("downloadImage rejects tiny, non-image and oversized responses", async () => {
  const opts = { lookupImpl: publicLookup, log };
  assert.equal(await downloadImage("https://x.example/a.png", { ...opts, fetchImpl: async () => respond(png(32, 32)) }), null);
  assert.equal(await downloadImage("https://x.example/a.svg", { ...opts, fetchImpl: async () => respond(Buffer.from("<svg/>".padEnd(40))) }), null);
  assert.equal(
    await downloadImage("https://x.example/big.png", { ...opts, fetchImpl: async () => respond(png(900, 900), { "content-length": String(6 * 1024 * 1024) }) }),
    null
  );
  const ok = await downloadImage("https://x.example/ok.png", { ...opts, fetchImpl: async () => respond(png(1200, 630)) });
  assert.equal(ok.type, "png");
  assert.equal(ok.width, 1200);
});

test("isPrivateAddress covers loopback, private, link-local, CGNAT and IPv6 local ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("assertPublicHttps blocks http, credentials, localhost and hosts resolving to private addresses", async () => {
  await assert.rejects(assertPublicHttps("http://example.com/a.png", { lookupImpl: publicLookup }), /non-https/);
  await assert.rejects(assertPublicHttps("https://user:pw@example.com/a.png", { lookupImpl: publicLookup }), /credentials/);
  await assert.rejects(assertPublicHttps("https://localhost/a.png", { lookupImpl: publicLookup }), /local host/);
  await assert.rejects(assertPublicHttps("https://127.0.0.1/a.png", { lookupImpl: publicLookup }), /private/);
  await assert.rejects(
    assertPublicHttps("https://rebind.example/a.png", { lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }] }),
    /private/
  );
  await assertPublicHttps("https://tool.example.com/a.png", { lookupImpl: publicLookup });
});

test("safeFetch validates every redirect hop", async () => {
  const toHttp = async () => redirect("http://cdn.example.com/a.png");
  await assert.rejects(safeFetch("https://tool.example.com/a.png", { fetchImpl: toHttp, lookupImpl: publicLookup }), /non-https/);

  const toMetadata = async () => redirect("https://169.254.169.254/latest/meta-data");
  await assert.rejects(safeFetch("https://tool.example.com/a.png", { fetchImpl: toMetadata, lookupImpl: publicLookup }), /private/);

  const loop = async (url) => redirect(url);
  await assert.rejects(safeFetch("https://tool.example.com/loop", { fetchImpl: loop, lookupImpl: publicLookup }), /too many redirects/);

  const hops = [];
  const ok = async (url) => {
    hops.push(url);
    return url.endsWith("/start") ? redirect("/final.png", 301) : respond(png(300, 300));
  };
  const { res, finalUrl } = await safeFetch("https://tool.example.com/start", { fetchImpl: ok, lookupImpl: publicLookup });
  assert.equal(res.status, 200);
  assert.equal(finalUrl, "https://tool.example.com/final.png");
  assert.deepEqual(hops, ["https://tool.example.com/start", "https://tool.example.com/final.png"]);
});

test("readBodyLimited stops a body that grows past the limit even without content-length", async () => {
  const big = new Response(new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  }));
  await assert.rejects(readBodyLimited(big, 200 * 1024), /exceeds/);
  const small = await readBodyLimited(respond(Buffer.from("hello")), 1024);
  assert.equal(small.toString(), "hello");
});

test("animated GIFs are flattened to their first frame, animated WebP is skipped", async () => {
  // GIF header + two Graphic Control Extensions = two frames
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(7), Buffer.from([0x21, 0xf9, 0x04, 0, 0, 0, 0, 0]), Buffer.alloc(10), Buffer.from([0x21, 0xf9, 0x04, 0, 0, 0, 0, 0])]);
  assert.equal(isAnimated(gif), true);
  assert.equal(isAnimated(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(7), Buffer.from([0x21, 0xf9, 0x04])])), false);
  const flattened = await downloadImage("https://x.example/logo.gif", {
    fetchImpl: async () => respond(gif),
    lookupImpl: publicLookup,
    firstFrame: () => png(400, 400),
    log,
  });
  assert.equal(flattened.type, "png");
  assert.equal(flattened.width, 400);

  const animatedWebp = webpVp8x(512, 512);
  animatedWebp[20] = 0x02;
  assert.equal(isAnimated(animatedWebp), true);
  assert.equal(isAnimated(webpVp8x(512, 512)), false);
  assert.equal(await downloadImage("https://x.example/a.webp", { fetchImpl: async () => respond(animatedWebp), lookupImpl: publicLookup, log }), null);
});

test("resolveToolImage falls back routine → PH thumbnail → og:image", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://routine.example/broken.png") return new Response("nope", { status: 404 });
    if (url === "https://ph-files.imgix.net/t.png") return respond(Buffer.from("not an image at all"));
    if (url === "https://tool.example.com") return respond('<meta property="og:image" content="https://tool.example.com/og.jpg">');
    if (url === "https://tool.example.com/og.jpg") return respond(jpeg(1200, 630));
    return new Response("", { status: 500 });
  };
  const snapshot = { days: [{ posts: [{ slug: "tool", thumbnail: "https://ph-files.imgix.net/t.png" }] }] };
  const img = await resolveToolImage(
    { imageUrl: "https://routine.example/broken.png", slug: "tool", website: "https://tool.example.com" },
    { thumbnails: snapshotThumbnails(snapshot), fetchImpl, lookupImpl: publicLookup, log }
  );
  assert.equal(img.from, "official og:image");
  assert.equal(img.type, "jpeg");
});

test("resolveToolImage never fetches an http image_url", async () => {
  let called = false;
  const img = await resolveToolImage(
    { imageUrl: "http://insecure.example/logo.png", slug: "x", website: null },
    { fetchImpl: async () => { called = true; return respond(png(400, 400)); }, lookupImpl: publicLookup, log }
  );
  assert.equal(img, null);
  assert.equal(called, false);
});

test("resolveToolImage returns null when nothing usable exists", async () => {
  const img = await resolveToolImage(
    { imageUrl: null, slug: "x", website: "https://nothing.example" },
    { fetchImpl: async () => new Response("<html></html>", { status: 200 }), lookupImpl: publicLookup, log }
  );
  assert.equal(img, null);
});
