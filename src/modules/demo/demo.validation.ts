import { z } from "zod";


export const createCourseSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(120),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().optional(),
  tags: z.array(z.string().max(24)).max(8).default([]),
  isFree: z.boolean(),
  requestedPrice: z.number().positive("Price must be positive").optional(),
  priceNote: z.string().max(500).optional(),
}).refine(
  data => data.isFree || (data.requestedPrice !== undefined && data.requestedPrice > 0),
  { message: "Paid courses must include a requested price", path: ["requestedPrice"] }
);
