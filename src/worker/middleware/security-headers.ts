import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const applySecurityHeaders: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
  if (c.req.path.startsWith("/api/")) c.header("cache-control", "no-store");
};
