import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";

import { fetchPublicPage, publicOrigin } from "@/lib/api-server";
import { buildPageMetadata } from "@/lib/page-metadata";

// One fetch per request for metadata and the redirect below.
const getPage = cache(fetchPublicPage);

/**
 * Server-side metadata for /p/[slug]: title, Open Graph (so a shared link shows
 * a preview in WhatsApp, Slack, iMessage) and robots. Only a public page is
 * indexable; a locked password page gives away its title and nothing else.
 * See lib/page-metadata.ts.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await getPage(slug);
  if (!data) {
    return { title: "Lumio", robots: { index: false, follow: false } };
  }
  return buildPageMetadata(data, await publicOrigin());
}

export default async function PageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { data } = await getPage(slug);
  // The studio's start page lives on "/". Its /p/<slug> is not a second
  // address for the same content.
  if (data?.page.isDefault) redirect("/");
  return children;
}
