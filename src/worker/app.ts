import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { errorHandler } from "./middleware/error-handler";
import { requireBasicAuth } from "./middleware/basic-auth";
import { requestLogger } from "./middleware/request-logger";
import { privateResponses, requireSameOrigin } from "./middleware/security";
import { categoriesRoutes } from "./features/categories/categories.routes";
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
app.use("*", secureHeaders({
  xFrameOptions: "DENY",
  // no-referrer makes Origin null on POST form navigations, including logout.
  referrerPolicy: "same-origin",
  strictTransportSecurity: "max-age=31536000",
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "https:", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
  },
}));
app.use("/api/*", requestLogger);
app.use("*", requireBasicAuth);
app.use("/api/*", requireSameOrigin);
app.use("/api/*", bodyLimit({
  maxSize: 5 * 1024 * 1024,
  onError: (c) => c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must be at most 5 MiB." } }, 413),
}));

// A normal form navigation lets the browser process Clear-Site-Data before
// following the redirect. The cookies directive also clears HTTP auth credentials
// in supporting browsers; JavaScript cannot directly clear the Basic auth cache.
app.post("/api/logout", (c) => {
  c.header("Clear-Site-Data", '"cookies"');
  return c.redirect("/", 303);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "electronics-inventory",
    timestamp: new Date().toISOString(),
  }),
);

app.route("/api/parts", partsRoutes);
app.route("/api/categories", categoriesRoutes);
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
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    // Fetch responses have immutable headers in Workers. Clone before the
    // security and cache middleware attaches headers to the asset response.
    return new Response(asset.body, asset);
  }

  return c.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404);
});
