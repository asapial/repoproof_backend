import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { errorResponseSchema } from "../contracts/v1";

export const assignV1RequestId: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  next();
};

export function sendV1Error(res: Response, status: number, code: string, message: string): void {
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : randomUUID();
  res.status(status).json(errorResponseSchema.parse({ error: { code, message, requestId } }));
}

// Return only fixed, public messages; never expose request data or exception details.
export function validateV1Body(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return sendV1Error(res, 400, "INVALID_INPUT", "Invalid request body");
    req.body = result.data;
    next();
  };
}

export const v1ErrorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (!/^\/api\/v1(?:\/|$)/i.test(req.path) || res.headersSent) return next(err);
  const kind = typeof err === "object" && err !== null && "type" in err ? err.type : undefined;
  if (kind === "entity.parse.failed") return sendV1Error(res, 400, "INVALID_JSON", "Invalid JSON body");
  if (kind === "entity.too.large") return sendV1Error(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  return sendV1Error(res, 500, "INTERNAL_ERROR", "Internal server error");
};
