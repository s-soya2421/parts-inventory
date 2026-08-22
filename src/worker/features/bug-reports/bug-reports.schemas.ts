import { z } from "zod";

export const bugReportWriteSchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(10).max(5000),
  stepsToReproduce: z.string().trim().max(4000).optional().default(""),
  expectedBehavior: z.string().trim().max(2000).optional().default(""),
  actualBehavior: z.string().trim().max(2000).optional().default(""),
  severity: z.enum(["low", "normal", "high", "critical"]).default("normal"),
});

export type BugReportWriteInput = z.infer<typeof bugReportWriteSchema>;
