import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolvePageBySlug(), resolveDefaultPage() and isPageSlugTaken(): the same
 * tenant rules as gallery slugs (gallery-lookup.test.ts).
 */
const cfg = vi.hoisted(() => ({
  DEPLOYMENT_MODE: "multi" as "single" | "multi",
}));
const findUnique = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());

vi.mock("../config.js", () => ({ config: cfg }));
vi.mock("../db.js", () => ({
  prisma: { landingPage: { findUnique, findMany, findFirst } },
}));

const SELECT = { select: { id: true, access: true } } as const;
const ROW = { id: "p1", access: "public" };

async function lookup() {
  return import("./landing-page-lookup.js");
}

describe("resolvePageBySlug", () => {
  beforeEach(() => {
    vi.resetModules();
    findUnique.mockReset();
    findMany.mockReset();
    findFirst.mockReset();
    cfg.DEPLOYMENT_MODE = "multi";
  });

  it("looks the page up on the composite (tenantId, slug) key in multi mode", async () => {
    findUnique.mockResolvedValue(ROW);
    const { resolvePageBySlug } = await lookup();
    expect(await resolvePageBySlug({ tenantId: "tenant-a" }, "portfolio", SELECT)).toEqual(ROW);
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_slug: { tenantId: "tenant-a", slug: "portfolio" } },
      select: SELECT.select,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("treats a miss as final and never falls back to another tenant", async () => {
    findUnique.mockResolvedValue(null);
    const { resolvePageBySlug } = await lookup();
    expect(await resolvePageBySlug({ tenantId: "tenant-a" }, "portfolio", SELECT)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("without a resolved tenant, serves the page only if exactly one matches", async () => {
    const { resolvePageBySlug } = await lookup();
    findMany.mockResolvedValue([ROW]);
    expect(await resolvePageBySlug({ tenantId: "" }, "portfolio", SELECT)).toEqual(ROW);
    findMany.mockResolvedValue([ROW, { id: "p2", access: "public" }]);
    expect(await resolvePageBySlug({ tenantId: "" }, "portfolio", SELECT)).toBeNull();
    findMany.mockResolvedValue([]);
    expect(await resolvePageBySlug({ tenantId: "" }, "portfolio", SELECT)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("asks for at most two rows on the slug-only path", async () => {
    findMany.mockResolvedValue([]);
    const { resolvePageBySlug } = await lookup();
    await resolvePageBySlug({ tenantId: "" }, "portfolio", SELECT);
    expect(findMany).toHaveBeenCalledWith({
      where: { slug: "portfolio" },
      select: SELECT.select,
      take: 2,
    });
  });

  it("single mode ignores a set tenantId and uses the slug-only lookup", async () => {
    cfg.DEPLOYMENT_MODE = "single";
    findMany.mockResolvedValue([ROW]);
    const { resolvePageBySlug } = await lookup();
    expect(await resolvePageBySlug({ tenantId: "oldest" }, "portfolio", SELECT)).toEqual(ROW);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("resolveDefaultPage", () => {
  beforeEach(() => {
    vi.resetModules();
    findFirst.mockReset();
    cfg.DEPLOYMENT_MODE = "multi";
  });

  it("returns null without a resolved tenant and does not query (apex of a multi-tenant instance)", async () => {
    const { resolveDefaultPage } = await lookup();
    expect(await resolveDefaultPage({ tenantId: "" }, SELECT)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("looks up the flagged page of exactly the resolved tenant", async () => {
    findFirst.mockResolvedValue(ROW);
    const { resolveDefaultPage } = await lookup();
    expect(await resolveDefaultPage({ tenantId: "tenant-a" }, SELECT)).toEqual(ROW);
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", isStudioDefault: true },
      select: SELECT.select,
    });
  });

  it("returns null when the tenant has no start page", async () => {
    findFirst.mockResolvedValue(null);
    const { resolveDefaultPage } = await lookup();
    expect(await resolveDefaultPage({ tenantId: "tenant-a" }, SELECT)).toBeNull();
  });
});

describe("isPageSlugTaken", () => {
  beforeEach(() => {
    vi.resetModules();
    findFirst.mockReset();
    cfg.DEPLOYMENT_MODE = "multi";
  });

  it("is scoped to the tenant in multi mode", async () => {
    findFirst.mockResolvedValue(null);
    const { isPageSlugTaken } = await lookup();
    expect(await isPageSlugTaken({ tenantId: "tenant-a", slug: "portfolio" })).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", slug: "portfolio" },
      select: { id: true },
    });
  });

  it("is instance-wide in single mode, so a second tenant cannot break the first one's links", async () => {
    cfg.DEPLOYMENT_MODE = "single";
    findFirst.mockResolvedValue({ id: "p9" });
    const { isPageSlugTaken } = await lookup();
    expect(await isPageSlugTaken({ tenantId: "tenant-b", slug: "portfolio" })).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { slug: "portfolio" },
      select: { id: true },
    });
  });

  it("excludes the page being renamed, so keeping its own slug is not a clash", async () => {
    findFirst.mockResolvedValue(null);
    const { isPageSlugTaken } = await lookup();
    await isPageSlugTaken({ tenantId: "tenant-a", slug: "portfolio", excludePageId: "p1" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", slug: "portfolio", NOT: { id: "p1" } },
      select: { id: true },
    });
  });
});
