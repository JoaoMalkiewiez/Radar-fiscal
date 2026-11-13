// Laboratory only: real loopback proxy; no hosted projects or simulated API responses.
import http from "node:http";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { privateJSON, validateConfig, privateLocations } from "./safety.mjs";
const config = privateJSON(process.env.RADAR_LAB_CONFIG);
validateConfig(config);
privateLocations([process.env.RADAR_LAB_CONFIG]);
const upstream = new URL(config.url);
const origin = "http://127.0.0.1:5517";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = new Map(
  [
    "juridico-portal.html",
    "juridico-portal.js",
    "juridico-portal.css",
    "juridico-gestao.css",
    "juridico-investigacao.js",
    "rural-csv.js",
  ].map((x) => ["/" + x, x]),
);
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (
    req.headers.host !== "127.0.0.1:5517" ||
    (req.headers.origin && req.headers.origin !== origin)
  ) {
    res.writeHead(403);
    res.end();
    return;
  }
  const url = new URL(req.url, origin);
  let pathname = url.pathname;
  try {
    if (pathname === "/api/juridico/config") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ url: origin, publishableKey: config.publicKey }),
      );
      return;
    }
    const api =
      /^\/auth\/v1\/(token|user|recover|logout)$/.test(pathname) ||
      /^\/rest\/v1\/legal_[a-z_]+$/.test(pathname) ||
      pathname.startsWith("/storage/v1/");
    if (api) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 11 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const headers = {};
      for (const name of ["apikey", "authorization", "content-type", "prefer"])
        if (req.headers[name]) headers[name] = req.headers[name];
      const response = await fetch(upstream.origin + pathname + url.search, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
        redirect: "manual",
        signal: AbortSignal.timeout(300000),
      });
      const location = response.headers.get("location");
      if (location && new URL(location, origin).origin !== origin) {
        res.writeHead(502);
        res.end("Unexpected laboratory redirect");
        return;
      }
      res.statusCode = response.status;
      for (const name of ["content-type", "content-disposition", "location"])
        if (response.headers.has(name))
          res.setHeader(name, response.headers.get(name));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (["/juridico/portal", "/juridico/portal/", "/"].includes(pathname))
      pathname = "/juridico-portal.html";
    const filename = assets.get(pathname);
    if (!filename || req.method !== "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      filename.endsWith(".js")
        ? "application/javascript"
        : filename.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(await fs.readFile(path.join(root, filename)));
  } catch {
    res.writeHead(502);
    res.end("Laboratory request unavailable");
  }
});
server.listen(5517, "127.0.0.1", () =>
  console.log("Laboratory portal listening on loopback port 5517"),
);
