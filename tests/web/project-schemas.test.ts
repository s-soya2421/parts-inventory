import { describe, expect, it } from "vitest";
import { projectWriteSchema } from "../../src/worker/features/projects/projects.schemas";

describe("projectWriteSchema", () => {
  it("defaults parts and costs to empty arrays", () => {
    const parsed = projectWriteSchema.parse({ name: "P1" });
    expect(parsed.parts).toEqual([]);
    expect(parsed.costs).toEqual([]);
  });

  it("rejects an empty name", () => {
    expect(projectWriteSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("defaults quantityRequired to one", () => {
    const parsed = projectWriteSchema.parse({ name: "P1", parts: [{ partId: 1 }] });
    expect(parsed.parts[0].quantityRequired).toBe(1);
  });

  it("defaults cost amount to zero and rejects negative amounts", () => {
    const parsed = projectWriteSchema.parse({ name: "P1", costs: [{ name: "加工代" }] });
    expect(parsed.costs[0].amount).toBe(0);
    expect(projectWriteSchema.safeParse({ name: "P1", costs: [{ name: "加工代", amount: -1 }] }).success).toBe(
      false,
    );
  });

  it("requires partId to be a positive integer", () => {
    expect(projectWriteSchema.safeParse({ name: "P1", parts: [{ partId: 0 }] }).success).toBe(false);
    expect(projectWriteSchema.safeParse({ name: "P1", parts: [{ partId: -1 }] }).success).toBe(false);
  });

  it("normalizes imageUrl", () => {
    const parsed = projectWriteSchema.parse({ name: "P1", imageUrl: "example.com/x.png" });
    expect(parsed.imageUrl).toBe("https://example.com/x.png");

    const empty = projectWriteSchema.parse({ name: "P1", imageUrl: "" });
    expect(empty.imageUrl).toBe(null);
  });
});
