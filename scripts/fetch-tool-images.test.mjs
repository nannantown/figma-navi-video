import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sniffImageType,
  imageSize,
  extractOgImage,
  downloadImage,
  resolveToolImage,
  snapshotThumbnails,
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

const respond = (buf, headers = {}) => new Response(buf, { status: 200, headers });

test("downloadImage rejects tiny, non-image and oversized responses", async () => {
  const log = () => {};
  assert.equal(await downloadImage("https://x.example/a.png", { fetchImpl: async () => respond(png(32, 32)), log }), null);
  assert.equal(await downloadImage("https://x.example/a.svg", { fetchImpl: async () => respond(Buffer.from("<svg/>".padEnd(40))), log }), null);
  assert.equal(
    await downloadImage("https://x.example/big.png", { fetchImpl: async () => respond(png(900, 900), { "content-length": String(6 * 1024 * 1024) }), log }),
    null
  );
  const ok = await downloadImage("https://x.example/ok.png", { fetchImpl: async () => respond(png(1200, 630)), log });
  assert.equal(ok.type, "png");
  assert.equal(ok.width, 1200);
});

test("resolveToolImage falls back routine → PH thumbnail → og:image", async () => {
  const log = () => {};
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
    { thumbnails: snapshotThumbnails(snapshot), fetchImpl, log }
  );
  assert.equal(img.from, "official og:image");
  assert.equal(img.type, "jpeg");
});

test("resolveToolImage returns null when nothing usable exists", async () => {
  const img = await resolveToolImage(
    { imageUrl: null, slug: "x", website: "https://nothing.example" },
    { fetchImpl: async () => new Response("<html></html>", { status: 200 }), log: () => {} }
  );
  assert.equal(img, null);
});
