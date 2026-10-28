---
name: create-api-module
description: >
  Creates a complete API module (route, controller, service, validation, types)
  following the exact architecture of this Express + Prisma + TypeScript backend.
  Triggered when the user asks to "create an API", "add a module", "add an endpoint",
  "create a route", or any variant of scaffolding a new feature backend.
---

# Skill: Create API Module

## Project Architecture Overview

This backend is an **Express 5 + Prisma + TypeScript (ESM)** project.

```
src/
├── modules/
│   └── <featureName>/
│       ├── <feature>.type.ts        ← TypeScript interfaces
│       ├── <feature>.validation.ts  ← Zod schemas
│       ├── <feature>.service.ts     ← Business logic + Prisma queries
│       ├── <feature>.controller.ts  ← Request handlers (uses catchAsync)
│       └── <feature>.route.ts       ← Express Router
├── middleware/
│   ├── checkAuth.ts       ← JWT auth guard: checkAuth(...roles)
│   └── validateRequest.ts ← Zod request validation middleware (validateRequest(schema))
├── utils/
│   ├── catchAsync.ts      ← Wraps async handlers, forwards errors to next()
│   ├── sendResponse.ts    ← Uniform JSON response helper
│   └── aiResponse.ts      ← OpenRouter AI helper (getAiResponse)
├── errorHelpers/
│   └── AppError.ts        ← Custom operational error class
├── lib/
│   └── prisma.ts          ← Singleton PrismaClient (PrismaPg adapter)
├── config/
│   └── env.ts             ← Type-safe env loader (envVars)
└── index.ts               ← Root router — mount new routers here
```

**Global base path:** all routes are mounted at `/api/v1` in `app.ts`.  
**DB import:** always `import { prisma } from "../../lib/prisma.js";`  
**Roles enum:** `import { Role } from "../../../prisma/generated/prisma/enums.js";`

---

## Step-by-Step: Adding a New Module

### 1. Create the folder

```
src/modules/<featureName>/
```

### 2. `<feature>.type.ts` — TypeScript interfaces

```typescript
// src/modules/<featureName>/<feature>.type.ts

export interface I<Feature> {
  // mirror the relevant Prisma model fields
  id?: string;
  title: string;
  description?: string;
  createdAt?: Date;
}
```

### 3. `<feature>.validation.ts` — Zod schemas

Always use `z` from `"zod"`. Export named schema constants.

```typescript
// src/modules/<featureName>/<feature>.validation.ts
import { z } from "zod";

export const create<Feature>Schema = z.object({
  body: z.object({
    title: z.string().min(3).max(120),
    description: z.string().max(2000).optional(),
  }),
});

export const update<Feature>Schema = z.object({
  body: z.object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().max(2000).optional(),
  }),
  params: z.object({
    id: z.string().cuid(),
  }),
});
```

> **Note:** `validateRequest` wraps `req.body`, `req.params`, `req.query` —
> nest your Zod schema under `body`, `params`, `query` keys accordingly.

### 4. `<feature>.service.ts` — Business logic

- Import `prisma` from `../../lib/prisma.js`
- Export a named object `<feature>Service`
- **Never** throw raw errors — use `AppError` for operational errors

```typescript
// src/modules/<featureName>/<feature>.service.ts
import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { I<Feature> } from "./<feature>.type.js";

const getAll = async () => {
  return prisma.<model>.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: "desc" },
  });
};

const getById = async (id: string) => {
  const item = await prisma.<model>.findUnique({ where: { id } });
  if (!item) throw new AppError(status.NOT_FOUND, "<Feature> not found.");
  return item;
};

const create = async (data: I<Feature>) => {
  return prisma.<model>.create({ data });
};

const update = async (id: string, data: Partial<I<Feature>>) => {
  await getById(id); // ensure exists
  return prisma.<model>.update({ where: { id }, data });
};

const remove = async (id: string) => {
  await getById(id);
  return prisma.<model>.update({ where: { id }, data: { isDeleted: true } });
};

export const <feature>Service = { getAll, getById, create, update, remove };
```

### 5. `<feature>.controller.ts` — Request handlers

- **Always** wrap handlers with `catchAsync` — never try/catch manually
- **Always** respond with `sendResponse`
- Access authenticated user via `req.user.userId`, `req.user.role`, `req.user.email`

```typescript
// src/modules/<featureName>/<feature>.controller.ts
import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { <feature>Service } from "./<feature>.service.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
  const result = await <feature>Service.getAll();
  sendResponse(res, {
    status: status.OK,
    success: true,
    message: "<Feature>s retrieved successfully",
    data: result,
  });
});

const getById = catchAsync(async (req: Request, res: Response) => {
  const result = await <feature>Service.getById(req.params.id);
  sendResponse(res, {
    status: status.OK,
    success: true,
    message: "<Feature> retrieved successfully",
    data: result,
  });
});

const create = catchAsync(async (req: Request, res: Response) => {
  const result = await <feature>Service.create(req.body);
  sendResponse(res, {
    status: status.CREATED,
    success: true,
    message: "<Feature> created successfully",
    data: result,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const result = await <feature>Service.update(req.params.id, req.body);
  sendResponse(res, {
    status: status.OK,
    success: true,
    message: "<Feature> updated successfully",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  await <feature>Service.remove(req.params.id);
  sendResponse(res, {
    status: status.OK,
    success: true,
    message: "<Feature> deleted successfully",
    data: null,
  });
});

export const <feature>Controller = { getAll, getById, create, update, remove };
```

### 6. `<feature>.route.ts` — Express Router

```typescript
// src/modules/<featureName>/<feature>.route.ts
import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { Role } from "../../../prisma/generated/prisma/enums.js";
import { <feature>Controller } from "./<feature>.controller.js";
import {
  create<Feature>Schema,
  update<Feature>Schema,
} from "./<feature>.validation.js";

const router = Router();

// Public
router.get("/", <feature>Controller.getAll);
router.get("/:id", <feature>Controller.getById);

// Protected
router.post(
  "/",
  checkAuth(Role.ADMIN, Role.TEACHER),
  validateRequest(create<Feature>Schema),
  <feature>Controller.create
);

router.patch(
  "/:id",
  checkAuth(Role.ADMIN),
  validateRequest(update<Feature>Schema),
  <feature>Controller.update
);

router.delete(
  "/:id",
  checkAuth(Role.ADMIN),
  <feature>Controller.remove
);

export const <feature>Router = router;
```

### 7. Register in `src/index.ts`

```typescript
import { Router } from "express";
import { <feature>Router } from "./modules/<featureName>/<feature>.route.js";

const router = Router();
router.use("/<featureName>", <feature>Router);
// → mounts at /api/v1/<featureName>

export const indexRouter = router;
```

---

## Key Utilities Reference

### `catchAsync` — async error forwarding
```typescript
export const catchAsync = (fn: RequestHandler) =>
  async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (error) { next(error); }  // ← globalErrorHandler takes over
  };
```

### `sendResponse` — uniform response shape
```typescript
sendResponse(res, {
  status: status.OK,
  success: true,
  message: "...",
  data: result,        // optional
  meta: {              // optional — paginated lists only
    page: 1, limit: 10, total: 100, totalPages: 10
  }
});
```
Response JSON: `{ success, message, data, meta }`

### `AppError` — operational errors
```typescript
throw new AppError(status.NOT_FOUND, "Resource not found.");
throw new AppError(status.FORBIDDEN, "You cannot access this.");
throw new AppError(status.BAD_REQUEST, "Invalid input.");
```

### `checkAuth` — role-based guard
```typescript
checkAuth()                          // any authenticated user
checkAuth(Role.ADMIN)                // admin only
checkAuth(Role.ADMIN, Role.TEACHER)  // admin OR teacher
// → populates req.user = { userId, role, email }
```

### `validateRequest` — Zod middleware
```typescript
validateRequest(myZodSchema)
// Schema keys: body / params / query
// On failure → ZodError → globalErrorHandler → 400
```

### `getAiResponse` — OpenRouter AI
```typescript
import { getAiResponse } from "../../utils/aiResponse.js";

const result = await getAiResponse<MyType>({
  context: "...",
  responseStyle: "Return JSON with keys: ...",
  retryNumber: 2,
  responseTime: 10_000,
  restrictedAnswer: "Do not mention ...", // optional
  // aiModel: "google/gemma-4-31b-it:free" // optional; auto-cycles if omitted
});
if (result.success && result.data) { /* use result.data */ }
```

---

## Available Roles (`prisma/schema/enums.prisma`)

```
ADMIN | TEACHER | STUDENT
```

---

## Error Response Shape

```json
{
  "success": false,
  "message": "Human-readable error",
  "errorSources": [{ "path": "fieldName", "message": "what went wrong" }],
  "error": "<dev-only raw error>",
  "stack": "<dev-only stack trace>"
}
```

---

## Checklist

- [ ] `src/modules/<name>/` folder created
- [ ] `.type.ts` — TypeScript interfaces
- [ ] `.validation.ts` — Zod schemas (keys: `body`, `params`, `query`)
- [ ] `.service.ts` — Prisma queries, `AppError` for failures, named service object
- [ ] `.controller.ts` — `catchAsync` + `sendResponse`, no try/catch
- [ ] `.route.ts` — `checkAuth`, `validateRequest`, controller methods wired
- [ ] `src/index.ts` — `router.use("/path", xyzRouter)` registered
- [ ] Prisma schema updated + `npm run migrate` if new table needed
