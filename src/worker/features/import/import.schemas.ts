import { z } from "zod";

// "skip": 既存はそのまま（新規のみ追加） / "update": 既存も上書き更新
export const importModeSchema = z.enum(["skip", "update"]).default("skip");

export const importPartRowSchema = z.object({
  category: z.string().trim().min(1),
  model_number: z.string().trim().min(1),
  name: z.string().trim().min(1),
  stock_quantity: z.coerce.number().int().nonnegative().default(0),
  price: z.coerce.number().nonnegative().optional().nullable(),
  case_number: z.string().trim().optional().nullable(),
  footprint: z.string().trim().optional().nullable(),
  manufacturer: z.string().trim().optional().nullable(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  memo: z.string().trim().optional().nullable(),
  low_stock_threshold: z.coerce.number().int().nonnegative().optional(),
  attributes_json: z.union([z.string(), z.record(z.string(), z.object({
    value: z.union([z.string(), z.number()]),
    unit: z.string().optional(),
    label: z.string().optional(),
  }))]).optional(),
  // 行ごとに既存の扱いを上書きしたい場合のみ指定（未指定なら全体モードに従う）
  mode: z.enum(["skip", "update"]).optional(),
});

export const importPartsSchema = z.object({
  rows: z.array(importPartRowSchema).min(1).max(1000, "一度に取り込める行数は1000件までです。"),
  mode: importModeSchema,
});

export type ImportPartRow = z.infer<typeof importPartRowSchema>;
export type ImportMode = z.infer<typeof importModeSchema>;
