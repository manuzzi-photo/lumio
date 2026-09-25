/**
 * Metadata (title, description, Open Graph, robots) of a landing page.
 *
 * Shared by /p/[slug] and the studio's start page on "/".
 *
 * What goes into it follows what a visitor may see:
 *   - Only a public page is indexable. link_only and password are noindex.
 *   - A locked password page gives away its title and nothing else: no intro,
 *     no cover.
 */
import type { Metadata } from "next";

import type { PublicLandingPage } from "@/lib/api";
import { fetchAssetAbsolute } from "@/lib/api-server";

/** Plain text from Markdown, good enough for a meta description. */
function markdownToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "") + "…";
}

export function buildPageMetadata(
  data: PublicLandingPage,
  origin: string
): Metadata {
  const p = data.page;
  const title = [p.title, p.studioName].filter(Boolean).join(" · ");
  const description =
    !p.locked && p.introMarkdown
      ? truncate(markdownToText(p.introMarkdown), 160) || undefined
      : undefined;
  const cover = !p.locked ? data.galleries.find((g) => g.cover)?.cover : null;
  const image = cover ? fetchAssetAbsolute(cover.url, origin) : null;

  return {
    title,
    description,
    ...(p.indexable ? {} : { robots: { index: false, follow: false } }),
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}
