import { describe, expect, it, vi } from "vitest";
import type { CategoriesRepository } from "../../src/worker/features/categories/categories.repository";
import type { PartsRepository } from "../../src/worker/features/parts/parts.repository";
import type { TagsRepository } from "../../src/worker/features/tags/tags.repository";
import { PartsService } from "../../src/worker/features/parts/parts.service";

function createMock<T>(overrides: Partial<T>): T {
  return overrides as unknown as T;
}

describe("PartsService", () => {
  it("throws PART_NOT_FOUND when the part does not exist", async () => {
    const service = new PartsService(
      createMock<PartsRepository>({ getById: vi.fn().mockResolvedValue(null) }),
      createMock<CategoriesRepository>({}),
      createMock<TagsRepository>({}),
    );

    await expect(service.getDetail(1)).rejects.toMatchObject({ code: "PART_NOT_FOUND", status: 404 });
  });

  it("throws CATEGORY_NOT_FOUND when creating a part without a valid category", async () => {
    const service = new PartsService(
      createMock<PartsRepository>({ ensureLocationByName: vi.fn(), create: vi.fn() }),
      createMock<CategoriesRepository>({ findById: vi.fn().mockResolvedValue(null) }),
      createMock<TagsRepository>({ ensureByName: vi.fn(), findById: vi.fn() }),
    );

    await expect(
      service.create({
        categoryId: 1,
        modelNumber: "RF-001",
        name: "2.4GHz Module",
        stockQuantity: 10,
        price: 320,
        caseNumber: "A-01",
        memo: "memo",
        lowStockThreshold: 3,
        tagIds: [],
        tagNames: [],
        attributes: [],
      } as any),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND", status: 404 });
  });

  it("creates a part and resolves new tags with location lookup", async () => {
    const partsRepository = createMock<PartsRepository>({
      create: vi.fn().mockResolvedValue(101),
      getById: vi.fn().mockResolvedValue({
        id: 101,
        categoryId: 1,
        categoryName: "RF",
        categorySlug: "rf",
        modelNumber: "RF-001",
        name: "2.4GHz Module",
        description: null,
        manufacturer: null,
        footprint: null,
        stockQuantity: 10,
        price: 320,
        locationId: 10,
        locationName: "Shelf A",
        locationCode: "shelf-a",
        caseNumber: "A-01",
        purchaseUrl: null,
        datasheetUrl: null,
        memo: "memo",
        lowStockThreshold: 3,
        searchText: "",
        archivedAt: null,
        createdAt: "2026-05-28T00:00:00Z",
        updatedAt: "2026-05-28T00:00:00Z",
        tags: [{ id: 10, name: "uart", slug: "uart" }],
        attributes: [],
      }),
      listMovements: vi.fn().mockResolvedValue([]),
      listAlternatives: vi.fn().mockResolvedValue([]),
      ensureLocationByName: vi.fn().mockResolvedValue(10),
    });

    const categoriesRepository = createMock<CategoriesRepository>({
      findById: vi.fn().mockResolvedValue({ id: 1, name: "RF" }),
    });

    const tagsRepository = createMock<TagsRepository>({
      ensureByName: vi.fn().mockResolvedValue({ id: 10, name: "uart" }),
      findById: vi.fn().mockResolvedValue({ id: 1, name: "rf" }),
    });

    const service = new PartsService(partsRepository, categoriesRepository, tagsRepository);

    const result = await service.create({
      categoryId: 1,
      modelNumber: "RF-001",
      name: "2.4GHz Module",
      stockQuantity: 10,
      price: 320,
      caseNumber: "A-01",
      memo: "memo",
      lowStockThreshold: 3,
      tagIds: [1],
      tagNames: ["uart"],
      attributes: [],
      locationName: "Shelf A",
    } as any);

    expect(partsRepository.create).toHaveBeenCalled();
    expect(tagsRepository.ensureByName).toHaveBeenCalledWith("uart");
    expect(result).toMatchObject({ id: 101, name: "2.4GHz Module", movements: [] });
  });


  it("propagates atomic stock update guard errors", async () => {
    const error = { code: "NEGATIVE_STOCK", status: 400 };
    const service = new PartsService(
      createMock<PartsRepository>({ changeStockAtomically: vi.fn().mockRejectedValue(error) }),
      createMock<CategoriesRepository>({}),
      createMock<TagsRepository>({}),
    );
    await expect(service.changeStock(1, { type: "out", quantity: 3 }))
      .rejects.toMatchObject(error);
  });

  it("delegates signed adjustments to the atomic stock repository", async () => {
    const partsRepository = createMock<PartsRepository>({
      changeStockAtomically: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue({ id: 1, stockQuantity: 7 }),
      listMovements: vi.fn().mockResolvedValue([]),
      listAlternatives: vi.fn().mockResolvedValue([]),
    });
    const service = new PartsService(
      partsRepository,
      createMock<CategoriesRepository>({}),
      createMock<TagsRepository>({}),
    );
    await service.changeStock(1, { type: "adjustment", quantity: -3, reason: "count", memo: "inventory count" });
    expect(partsRepository.changeStockAtomically).toHaveBeenCalledWith(
      1, { type: "adjustment", quantity: -3, reason: "count", memo: "inventory count" },
    );
  });

  it("supports an absolute stock set to zero through the atomic repository", async () => {
    const partsRepository = createMock<PartsRepository>({
      changeStockAtomically: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue({ id: 1, stockQuantity: 0 }),
      listMovements: vi.fn().mockResolvedValue([]),
      listAlternatives: vi.fn().mockResolvedValue([]),
    });
    const service = new PartsService(
      partsRepository,
      createMock<CategoriesRepository>({}),
      createMock<TagsRepository>({}),
    );
    await service.changeStock(1, { type: "set", quantity: 0, reason: "count", memo: "empty" });
    expect(partsRepository.changeStockAtomically).toHaveBeenCalledWith(
      1, { type: "set", quantity: 0, reason: "count", memo: "empty" },
    );
  });
});
