import { z } from "zod";

const urlInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}, z.string().url().nullable().optional());

export const partAttributeInputSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().optional().nullable(),
  value: z.string().trim().min(1),
  unit: z.string().trim().optional().nullable(),
  normalizedValue: z.string().trim().optional().nullable(),
});

export const partWriteSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  modelNumber: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  manufacturer: z.string().trim().optional().nullable(),
  footprint: z.string().trim().optional().nullable(),
  stockQuantity: z.coerce.number().int().nonnegative(),
  price: z.coerce.number().nonnegative().optional().nullable(),
  locationId: z.coerce.number().int().positive().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  caseNumber: z.string().trim().optional().nullable(),
  purchaseUrl: urlInputSchema,
  datasheetUrl: urlInputSchema,
  memo: z.string().trim().optional().nullable(),
  lowStockThreshold: z.coerce.number().int().nonnegative().default(0),
  statusId: z.coerce.number().int().positive().optional().nullable(),
  attributes: z.array(partAttributeInputSchema).max(100).default([]),
  tagIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
  tagNames: z.array(z.string().trim().min(1)).max(100).default([]),
  alternatives: z.array(z.string().trim().min(1)).max(100).default([]),
});

export const stockChangeSchema = z
  .object({
    type: z.enum(["in", "out", "set", "adjustment", "use", "dispose"]),
    quantity: z.coerce.number().int(),
    reason: z.string().trim().optional().nullable(),
    memo: z.string().trim().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "set" && value.quantity < 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Set quantity must be zero or greater." });
    } else if (value.type === "adjustment" && value.quantity === 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Adjustment quantity must not be zero." });
    } else if (value.type !== "set" && value.type !== "adjustment" && value.quantity <= 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity must be greater than zero." });
    }
  });

export const bulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  data: z.object({
    categoryId: z.coerce.number().int().positive().optional(),
    manufacturer: z.string().trim().optional().nullable(),
    footprint: z.string().trim().optional().nullable(),
    locationId: z.coerce.number().int().positive().optional().nullable(),
    locationName: z.string().trim().optional().nullable(),
    caseNumber: z.string().trim().optional().nullable(),
    lowStockThreshold: z.coerce.number().int().nonnegative().optional(),
    statusId: z.coerce.number().int().positive().optional().nullable(),
    memo: z.string().trim().optional().nullable(),
  }),
});

export type PartWriteInput = z.infer<typeof partWriteSchema>;
export type StockChangeInput = z.infer<typeof stockChangeSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
