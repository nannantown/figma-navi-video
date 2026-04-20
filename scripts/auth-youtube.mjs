/**
 * One-time YouTube OAuth 2.0 authorization helper (loopback redirect flow).
 *
 * Run locally to obtain a refresh token:
 *   node scripts/auth-youtube.mjs
 *
 * Prerequisites:
 *   1. Google Cloud project with YouTube Data API v3 enabled
 *   2. OAuth 2.0 credentials (Desktop application type)
 *   3. Environment variables:
 *      export YOUTUBE_CLIENT_ID=your-client-id
 *      export YOUTUBE_CLIENT_SECRET=your-client-secret
 *
 * Starts a local HTTP server on an ephemeral port and captures the auth
 * code via redirect. OOB flow was deprecated by Google in 2022, so new
 * Desktop clients must use this loopback redirect flow.
 */

import { google } from "googleapis";
import { createServer } from "http";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.log(`(Could not auto-open browser: ${err.message})`);
  });
}

function waitForAuthCode(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = u.searchParams.get("code");
      const error = u.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>認証エラー</h1><pre>${error}</pre>`);
        server.close();
        return reject(new Error(`OAuth error: ${error}`));
      }
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif;padding:40px;max-width:600px;margin:auto}</style><h1>認証成功</h1><p>このタブは閉じてターミナルに戻ってください。</p>`
        );
        server.close();
        return resolve(code);
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, "127.0.0.1");
    server.on("error", reject);
  });
}

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Error: Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first.\n" +
        "  export YOUTUBE_CLIENT_ID=your-client-id\n" +
        "  export YOUTUBE_CLIENT_SECRET=your-client-secret"
    );
    process.exit(1);
  }

  // Pick an ephemeral port, then close and reuse it for the real server
  const port = await new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });

  const redirectUri = `http://127.0.0.1:${port}`;
  console.log(`Redirect URI: ${redirectUri}`);

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
  });

  console.log("\n=== YouTube OAuth 2.0 Authorization ===");
  console.log("Opening browser. If it doesn't open, visit this URL manually:\n");
  console.log(authUrl);
  console.log("");

  const codePromise = waitForAuthCode(port);
  openBrowser(authUrl);

  console.log("Waiting for authorization in browser...\n");
  const code = await codePromise;

  console.log("Exchanging code for tokens...");
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "Error: No refresh token received. Revoke access at\n" +
        "  https://myaccount.google.com/permissions\nand try again."
    );
    process.exit(1);
  }

  console.log("\n=== Success! ===");
  console.log(`Refresh Token: ${tokens.refresh_token}\n`);

  mkdirSync(outputDir, { recursive: true });
  const tokenPath = join(outputDir, "youtube-refresh-token.txt");
  writeFileSync(tokenPath, tokens.refresh_token);
  console.log(`Saved to: ${tokenPath}`);
  console.log("(gitignored — do not commit)\n");

  console.log("Next:");
  console.log(`  gh secret set YOUTUBE_REFRESH_TOKEN --body "${tokens.refresh_token}"`);
}

main().catch((err) => {
  console.error("Authorization failed:", err.message);
  process.exit(1);
});
