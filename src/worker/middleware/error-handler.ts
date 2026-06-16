import type { Context, ErrorHandler } from "hono";
import { ZodError } from "zod";
import type { Env } from "../types";

function logServerError(error: unknown, c: Context<Env>) {
  const metadata = {
    event: "unhandled_server_error",
    method: c.req.method,
    url: c.req.url,
    clientIp: c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown",
  };

  if (error instanceof Error) {
    console.error({
      ...metadata,
      message: error.message,
      stack: error.stack,
    });
  } else {
    console.error({
      ...metadata,
      error,
    });
  }
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorHandler<Env> = (error, c) => {
  if (error instanceof SyntaxError) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Malformed JSON body.",
        },
      },
      400,
    );
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          issues: error.issues,
        },
      },
      400,
    );
  }

  if (error instanceof AppError) {
    return c.json({ error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } }, error.status as 400);
  }

  logServerError(error, c);
  return c.json(
    { error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error." } },
    500,
  );
};
