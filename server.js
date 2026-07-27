require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PUBLIC_DIR = __dirname;
const publicFiles = new Set(["/index.html", "/style.css", "/updated.js"]);

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitStore = new Map();

let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (requestUrl.pathname === "/api/search") {
      await handleSearch(request, response, requestUrl);
      return;
    }

    serveStaticFile(response, requestUrl.pathname);
  } catch (error) {
    sendJson(response, 500, { error: "Server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

async function handleSearch(request, response, requestUrl) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    sendJson(response, 500, {
      error:
        "Missing Spotify credentials. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
    });
    return;
  }

  const rateLimit = checkRateLimit(getClientIp(request));

  if (!rateLimit.allowed) {
    response.setHeader(
      "Retry-After",
      String(Math.ceil(rateLimit.retryAfterMs / 1000)),
    );
    sendJson(response, 429, {
      error: `Too many searches. Please wait ${Math.ceil(rateLimit.retryAfterMs / 1000)} seconds.`,
    });
    return;
  }

  const songName = requestUrl.searchParams.get("q")?.trim();

  if (!songName) {
    sendJson(response, 400, { error: "Missing song name." });
    return;
  }

  const token = await getSpotifyAccessToken();
  const track = await findSong(songName, token);

  sendJson(response, 200, { track });
}

function checkRateLimit(clientIp) {
  const now = Date.now();
  const savedRecord = rateLimitStore.get(clientIp);
  const record =
    savedRecord && now < savedRecord.resetAt
      ? savedRecord
      : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  record.count += 1;
  rateLimitStore.set(clientIp, record);

  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterMs: record.resetAt - now,
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}

function getClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.socket.remoteAddress || "unknown";
}

async function getSpotifyAccessToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt) {
    return spotifyToken;
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
    "base64",
  );
  const spotifyResponse = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials",
    },
  );

  if (!spotifyResponse.ok) {
    throw new Error("Could not connect to Spotify.");
  }
  const data = await spotifyResponse.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  return spotifyToken;
}

async function findSong(songName, token) {
  const spotifyUrl = new URL("https://api.spotify.com/v1/search");
  spotifyUrl.searchParams.set("q", songName);
  spotifyUrl.searchParams.set("type", "track");
  spotifyUrl.searchParams.set("limit", "1");

  const spotifyResponse = await fetch(spotifyUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!spotifyResponse.ok) {
    throw new Error("Song search failed.");
  }

  const data = await spotifyResponse.json();
  return data.tracks.items[0] || null;
}

function serveStaticFile(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;

  if (!publicFiles.has(requestedPath)) {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
    });
    response.end(content);
  });
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}
