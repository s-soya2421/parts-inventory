import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { errorHandler } from "./middleware/error-handler";
import { logoutChallenge, requireBasicAuth } from "./middleware/basic-auth";
import { MAX_JSON_BODY_BYTES } from "./middleware/request-body";
import { requestLogger } from "./middleware/request-logger";
import { applySecurityHeaders } from "./middleware/security-headers";
import { privateResponses, requireSameOrigin } from "./middleware/security";
import { categoriesRoutes } from "./features/categories/categories.routes";
import { bugReportsRoutes } from "./features/bug-reports/bug-reports.routes";
import { exportRoutes } from "./features/export/export.routes";
import { importRoutes } from "./features/import/import.routes";
import { locationsRoutes } from "./features/locations/locations.routes";
import { partsRoutes } from "./features/parts/parts.routes";
import { projectsRoutes } from "./features/projects/projects.routes";
import { statusesRoutes } from "./features/statuses/statuses.routes";
import { tagsRoutes } from "./features/tags/tags.routes";
import type { Env } from "./types";

export const app = new Hono<Env>();

app.onError(errorHandler);
app.use("*", privateResponses);
app.use("*", applySecurityHeaders);
app.use("/api/*", requestLogger);
app.use("*", requireBasicAuth);
app.use("/api/*", requireSameOrigin);
app.use("/api/*", bodyLimit({
  maxSize: MAX_JSON_BODY_BYTES,
  onError: (c) => c.json({ error: { code: "REQUEST_BODY_TOO_LARGE", message: "Request body is too large." } }, 413),
}));

// Reject even valid credentials for the SAME protection space. A 303 alone does
// not invalidate the browser's Basic auth cache. The user must cancel any native
// authentication prompt; after cancellation the HTML returns them to the top.
// This is browser-dependent, not server-side revocation. Do not clear cookies or
// storage: those are unrelated to the HTTP authentication cache.
app.post("/api/logout", () => logoutChallenge());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "electronics-inventory",
    timestamp: new Date().toISOString(),
  }),
);

app.route("/api/parts", partsRoutes);
app.route("/api/categories", categoriesRoutes);
app.route("/api/bug-reports", bugReportsRoutes);
app.route("/api/locations", locationsRoutes);
app.route("/api/tags", tagsRoutes);
app.route("/api/projects", projectsRoutes);
app.route("/api/statuses", statusesRoutes);
app.route("/api/import", importRoutes);
app.route("/api/export", exportRoutes);

app.notFound(async (c) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
  }
  if (c.env.ASSETS) {
    let asset = await c.env.ASSETS.fetch(c.req.raw);
    // SPA deep links must fall back *after* Basic auth and CSRF middleware.
    // Static assets or API misses must never be rewritten to index.html.
    if (asset.status === 404 && c.req.method === "GET" &&
        c.req.header("accept")?.includes("text/html")) {
      asset = await c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url), {
        method: "GET",
        headers: c.req.raw.headers,
      }));
    }
    // Fetch responses have immutable headers in Workers. Clone before the
    // security and cache middleware attaches headers to the asset response.
    return new Response(asset.body, asset);
  }

  return c.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
});
