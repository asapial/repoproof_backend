import { z } from "zod";

// Public, curated metadata only. This schema is safe to share with clients.
export const safeFixtureSchema = z.object({
  repositoryId: z.string().regex(/^[a-z0-9-]+$/).max(128),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200),
  fixtureKey: z.string().regex(/^[a-z0-9-]+$/).max(128),
  issueNumber: z.number().int().positive().safe(),
  source: z.literal("CURATED"),
}).strict();

export const safeFixtureCatalogSchema = z.object({ repositories: z.array(safeFixtureSchema).max(100) }).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const item of catalog.repositories) {
    if (ids.has(item.repositoryId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate repository identifier" });
    ids.add(item.repositoryId);
  }
});

export type SafeFixture = z.infer<typeof safeFixtureSchema>;
export type SafeFixtureCatalog = z.infer<typeof safeFixtureCatalogSchema>;
