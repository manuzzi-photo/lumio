import type { Metadata } from "next";

import {
  fetchPublicGallery,
  fetchAssetAbsolute,
  publicOrigin,
} from "@/lib/api-server";

/**
 * Server-side metadata für /g/[slug].
 *
 * Liest die Galerie über die API (server-seitig, kein Cookie) und baut
 * die Open-Graph-Tags daraus. Damit zeigt WhatsApp/iMessage/Slack/Mail
 * beim Teilen des Links die echte Galerie-Vorschau (Logo, Titel,
 * Hero-Bild).
 *
 * Wenn die Galerie nicht existiert oder der Tenant inaktiv ist, geben
 * wir nur einen generischen Title zurück — kein 404 hier, weil die
 * eigentliche Page das Routing übernimmt.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchPublicGallery(slug).catch(() => null);
  if (!data) {
    return { title: "Galerie · Lumio" };
  }
  const g = data.gallery;

  // Studio-Name, nicht branding.name: letzteres ist die INTERNE
  // Profilbezeichnung ("Standard", "Hochzeit-Style") und stand damit
  // im Browser-Tab und in jeder Share-Vorschau. Der oeffentliche Name
  // des Studios ist Tenant.displayName (Fallback .name), gepflegt in
  // den Studio-Einstellungen.
  const titleParts = [g.title];
  if (g.studioName) titleParts.push(g.studioName);
  const title = titleParts.join(" · ");
  const description = g.description ?? undefined;

  // OG-Image-Priorität: Hero-Bild > Event-Logo > nichts. Hero ist der
  // bestmögliche Eindruck im Share-Preview, das Event-Logo ist
  // Fallback (z.B. wenn der Fotograf noch kein Hero-Bild gesetzt hat).
  // Origin aus dem Request, nicht aus einer Env — im Multi-Tenant-Betrieb
  // unterscheidet sie sich pro Studio (Subdomain oder Custom-Domain).
  const origin = await publicOrigin();
  const ogImageUrl = g.header?.heroImageUrl
    ? fetchAssetAbsolute(g.header.heroImageUrl, origin)
    : g.header?.eventLogoUrl
    ? fetchAssetAbsolute(g.header.eventLogoUrl, origin)
    : null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: ogImageUrl ? [{ url: ogImageUrl }] : undefined,
    },
    twitter: {
      card: ogImageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: ogImageUrl ? [ogImageUrl] : undefined,
    },
  };
}

export default function GallerySlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
