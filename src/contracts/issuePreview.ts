import { z } from "zod";

// Public read-only metadata. It confers no run, source-admission or execution permission.
export const issuePreviewSchema = z.object({
  repositoryId: z.literal("repoproof-backend"),
  repository: z.literal("asapial/repoproof_backend"),
  fixtureKey: z.literal("discount-bug"),
  baseSha: z.literal("1066351c5b07bed024775a16af9151048a9316b2"),
  source: z.literal("GITHUB_API"),
  fetchedAt: z.string().datetime(),
  issues: z.array(z.object({
    number: z.literal(1), title: z.string().min(1).max(500), body: z.string().min(1).max(16000),
    url: z.literal("https://github.com/asapial/repoproof_backend/issues/1"),
  }).strict()).length(1),
}).strict();
export type IssuePreview = z.infer<typeof issuePreviewSchema>;
