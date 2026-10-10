import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

const REALM = "electronics-inventory";
export const BASIC_AUTH_CHALLENGE = `Basic realm="${REALM}", charset="UTF-8"`;

function unauthorized() {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": BASIC_AUTH_CHALLENGE,
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}

function parseBasicAuthorization(header: string | undefined): { user: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;

    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export const requireBasicAuth = createMiddleware<Env>(async (c, next) => {
  const configuredUser = c.env.BASIC_AUTH_USER?.trim();
  const configuredPassword = c.env.BASIC_AUTH_PASSWORD?.trim();

  if (!configuredUser || !configuredPassword) {
    return c.json(
      {
        error: {
          code: "BASIC_AUTH_NOT_CONFIGURED",
          message: "Basic authentication is not configured.",
        },
      },
      500,
    );
  }

  const credentials = parseBasicAuthorization(c.req.header("authorization"));
  if (
    !credentials ||
    !timingSafeEqual(credentials.user, configuredUser) ||
    !timingSafeEqual(credentials.password, configuredPassword)
  ) {
    return unauthorized();
  }

  await next();
});
