/**
 * Lumio API — gallery cover thumbnails
 *
 * One thumbnail per gallery: the hero file if one is set, otherwise the first
 * image by sort order. Shared by the studio gallery list and the landing pages
 * (studio editor, public page and the cover endpoint), so all of them pick the
 * same picture.
 *
 * Only storage keys and sizes come back. Turning a key into a URL is the
 * caller's job (presignGet), because how long that URL may live differs: the
 * studio list is behind a login, the public cover endpoint hands out a link
 * that lives for minutes.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";

export interface CoverThumb {
  storageKey: string;
  /** Rendition size in px, null if the worker did not record it. */
  width: number | null;
  height: number | null;
}

/**
 * @param publicOnly  Only consider files a visitor may see (status ready and
 *   publicVisibility visible) when falling back to the first image. Files that
 *   arrived through an upload link and still await approval are hidden, and a
 *   public page must not use one as a cover. The studio list leaves this off:
 *   the studio sees those files anyway. An explicit hero file is honoured in
 *   both cases, it is the studio's own choice (the gallery header does the same).
 */
export async function resolveCoverThumbs(
  galleries: Array<{ id: string; heroFileId: string | null }>,
  opts: { publicOnly?: boolean } = {}
): Promise<Map<string, CoverThumb>> {
  const covers = new Map<string, CoverThumb>();
  if (galleries.length === 0) return covers;
  const ids = galleries.map((g) => g.id);

  // 1) First image per gallery (fallback cover)
  const publicFilter = opts.publicOnly
    ? Prisma.sql`AND f.status = 'ready' AND f."publicVisibility" = 'visible'`
    : Prisma.empty;
  const firstThumbs = await prisma.$queryRaw<
    Array<{
      gid: string;
      key: string;
      width: number | null;
      height: number | null;
    }>
  >`
    SELECT DISTINCT ON (f."galleryId")
           f."galleryId" AS gid, r."storageKey" AS key, r.width AS width, r.height AS height
    FROM files f
    JOIN renditions r ON r."fileId" = f.id AND r.kind = 'thumb'
    WHERE f."galleryId" = ANY(${ids}::uuid[]) AND f.kind = 'image' ${publicFilter}
    ORDER BY f."galleryId", f."sortIndex" ASC, f."createdAt" ASC
  `;
  for (const row of firstThumbs) {
    covers.set(row.gid, {
      storageKey: row.key,
      width: row.width,
      height: row.height,
    });
  }

  // 2) Hero file override, where set. The file must belong to the gallery that
  //    names it as its hero.
  const galleryByHeroFile = new Map(
    galleries.filter((g) => g.heroFileId).map((g) => [g.heroFileId as string, g.id])
  );
  if (galleryByHeroFile.size > 0) {
    const heroThumbs = await prisma.rendition.findMany({
      where: { fileId: { in: [...galleryByHeroFile.keys()] }, kind: "thumb" },
      select: {
        storageKey: true,
        width: true,
        height: true,
        file: { select: { id: true, galleryId: true } },
      },
    });
    for (const r of heroThumbs) {
      if (galleryByHeroFile.get(r.file.id) !== r.file.galleryId) continue;
      covers.set(r.file.galleryId, {
        storageKey: r.storageKey,
        width: r.width,
        height: r.height,
      });
    }
  }

  return covers;
}
