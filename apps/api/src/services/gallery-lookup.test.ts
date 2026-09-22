import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveGalleryBySlug(): slugs are unique per tenant, so the lookup is
 * tenant-scoped whenever the request host maps to a tenant, and falls back to
 * a slug-only lookup (served only if unambiguous) when it does not.
 */
const cfg = vi.hoisted(() => ({
  DEPLOYMENT_MODE: "multi" as "single" | "multi",
}));
const findUnique = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());

vi.mock("../config.js", () => ({ config: cfg }));
vi.mock("../db.js", () => ({
  prisma: { gallery: { findUnique, findMany } },
}));

const SELECT = { select: { id: true, status: true } } as const;
const ROW = { id: "g1", status: "live" };

const resolve = async (tenantId: string, slug = "hochzeit") =>
  (await import("./gallery-lookup.js")).resolveGalleryBySlug(
    { tenantId },
    slug,
    SELECT
  );

describe("resolveGalleryBySlug", () => {
  beforeEach(() => {
    vi.resetModules();
    findUnique.mockReset();
    findMany.mockReset();
    cfg.DEPLOYMENT_MODE = "multi";
  });

  describe("multi mode, tenant resolved from the host", () => {
    it("looks the gallery up on the composite (tenantId, slug) key", async () => {
      findUnique.mockResolvedValue(ROW);
      expect(await resolve("tenant-a")).toEqual(ROW);
      expect(findUnique).toHaveBeenCalledWith({
        where: { tenantId_slug: { tenantId: "tenant-a", slug: "hochzeit" } },
        select: SELECT.select,
      });
      expect(findMany).not.toHaveBeenCalled();
    });

    it("treats a miss as final and never falls back to another tenant", async () => {
      findUnique.mockResolvedValue(null);
      expect(await resolve("tenant-a")).toBeNull();
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe("multi mode, no tenant resolved (tenantId is empty)", () => {
    it("returns null when no gallery has the slug", async () => {
      findMany.mockResolvedValue([]);
      expect(await resolve("")).toBeNull();
    });

    it("serves the gallery when exactly one matches", async () => {
      findMany.mockResolvedValue([ROW]);
      expect(await resolve("")).toEqual(ROW);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("refuses to guess when several tenants use the slug", async () => {
      findMany.mockResolvedValue([ROW, { id: "g2", status: "live" }]);
      expect(await resolve("")).toBeNull();
    });

    it("asks for at most two rows, enough to tell unique from ambiguous", async () => {
      findMany.mockResolvedValue([]);
      await resolve("");
      expect(findMany).toHaveBeenCalledWith({
        where: { slug: "hochzeit" },
        select: SELECT.select,
        take: 2,
      });
    });
  });

  describe("single mode", () => {
    it("ignores a set tenantId and uses the slug-only lookup", async () => {
      cfg.DEPLOYMENT_MODE = "single";
      findMany.mockResolvedValue([ROW]);
      expect(await resolve("oldest-tenant")).toEqual(ROW);
      expect(findUnique).not.toHaveBeenCalled();
    });
  });
});
