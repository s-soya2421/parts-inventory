import { z } from "zod";

const urlInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}, z.string().url().nullable().optional());

export const projectPartInputSchema = z.object({
  partId: z.coerce.number().int().positive(),
  quantityRequired: z.coerce.number().int().positive().default(1),
  memo: z.string().trim().optional().nullable(),
});

export const projectCostInputSchema = z.object({
  name: z.string().trim().min(1),
  amount: z.coerce.number().nonnegative().default(0),
  memo: z.string().trim().optional().nullable(),
});

export const projectWriteSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  imageUrl: urlInputSchema,
  referenceUrl: urlInputSchema,
  parts: z.array(projectPartInputSchema).default([]),
  costs: z.array(projectCostInputSchema).default([]),
});

export type ProjectPartInput = z.infer<typeof projectPartInputSchema>;
export type ProjectCostInput = z.infer<typeof projectCostInputSchema>;
export type ProjectWriteInput = z.infer<typeof projectWriteSchema>;
