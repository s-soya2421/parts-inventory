import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

// Basic credentials are sent automatically by browsers, so they do not prevent CSRF.
export const requireSameOrigin = createMiddleware<Env>(async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();

  const origin = c.req.header("origin");
  const fetchSite = c.req.header("sec-fetch-site");
  if (
    (origin !== undefined && origin !== new URL(c.req.url).origin) ||
    fetchSite === "cross-site" || fetchSite === "same-site"
  ) {
    return c.json({ error: { code: "FORBIDDEN_ORIGIN", message: "Cross-origin requests are not allowed." } }, 403);
  }

  // Browser forms can send text/plain JSON without a CORS preflight. Only the
  // logout form is allowed to use a form content type; its origin is checked above.
  if (c.req.path !== "/api/logout" && c.req.raw.body) {
    const contentType = c.req.header("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return c.json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Use application/json." } }, 415);
    }
  }

  await next();
});

export const privateResponses = createMiddleware<Env>(async (c, next) => {
  await next();
  // Include assets, auth failures and exports. No browser/shared HTTP cache may
  // retain a protected response for reuse after logout.
  c.header("Cache-Control", "no-store");
  const vary = c.res.headers.get("Vary");
  c.header("Vary", vary ? `${vary}, Authorization` : "Authorization");
});
