/**
 * Lumio — Root-Route
 *
 * Modusabhängiger Einstieg:
 *
 *   Single-Mode (Self-Hoster, EIN Tenant pro Deployment):
 *     Permanenter Redirect auf /login. Es gibt keine Tenant-Auswahl,
 *     also keinen Sinn für eine Zwischenseite. Wer schon eingeloggt
 *     ist, wird vom /login auf /studio weitergeleitet (das übernimmt
 *     die LoginPage selbst).
 *
 *   Multi-Mode (Cloud, viele Tenants über Subdomains):
 *     - Auf der Apex-Domain (z.B. lumio-cloud.de) → Tenant-Picker
 *       (Form für Slug-Eingabe → Subdomain-Redirect)
 *     - Auf einer Tenant-Subdomain (z.B. stefan.lumio-cloud.de) →
 *       Redirect auf /login (Tenant ist durch Host bereits identifiziert)
 *
 *   Startseite (Landing Pages): hat ein Studio eine Page zur Startseite
 *   gemacht, wird sie hier ausgeliefert, statt auf /login zu leiten (Single-
 *   Mode, Tenant-Subdomain, Custom-Domain). Ohne Startseite bleibt alles wie
 *   oben beschrieben. Der Login bleibt unter /login und ist im Footer der
 *   Startseite verlinkt.
 *
 *   Die Apex-vs-Subdomain-Unterscheidung passiert Server-Side über den
 *   Host-Header. Dadurch entsteht keine sichtbare Zwischenseite mit
 *   "lädt..."-Zustand.
 *
 * Pre-Alpha-Status-Anzeige ist hier raus. Wer den API-Health-Endpoint
 * sehen will, geht direkt zu /api/v1/health.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";

import { PublicPageView } from "@/components/landing/PublicPageView";
import { TenantPicker } from "@/components/landing/TenantPicker";
import { fetchStartPage, publicOrigin } from "@/lib/api-server";
import { buildPageMetadata } from "@/lib/page-metadata";

const MODE = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? "single";
const DOMAIN_BASE = process.env.NEXT_PUBLIC_DOMAIN_BASE ?? "";

// "/" depends on who asks: the host decides which studio, and whether that
// studio has a start page can change at any time. Never prerender it. (In
// single mode this used to be a plain redirect, which Next may prerender.)
export const dynamic = "force-dynamic";

// Reservierte Subdomains (studio, api, admin, app, www) zaehlen AUCH als
// Apex-aequivalent — sie sind keine Tenant-Subdomains.
// 'studio.lumio-cloud.de' ist der zentrale Login-Host fuer alle
// Tenants im Multi-Mode.
const RESERVED_SUBDOMAINS = ["www", "studio", "api", "admin", "app"];

function isApexHost(host: string): boolean {
  return (
    !DOMAIN_BASE ||
    host === DOMAIN_BASE ||
    RESERVED_SUBDOMAINS.some((sd) => host === `${sd}.${DOMAIN_BASE}`)
  );
}

/**
 * The page this studio has made its start page, or null. A studio that never
 * did keeps exactly the behaviour below (redirect to /login, or the tenant
 * picker on the apex). Any failure to ask, the API being down included, also
 * ends up as null: the front door must not break because of this feature.
 *
 * It asks the API for every host, the apex included, instead of guessing from
 * NEXT_PUBLIC_DOMAIN_BASE which hosts belong to a studio. That guess is wrong
 * for a studio on a custom domain when no domain base is configured (method B
 * in docs/MULTI_TENANT.md), and it is unnecessary: on a multi-tenant instance
 * the API finds no studio for the apex or an unknown host and answers 404, so
 * those keep the tenant picker or the login redirect.
 */
const getStartPage = cache(() => fetchStartPage());

export async function generateMetadata(): Promise<Metadata> {
  const start = await getStartPage();
  return start ? buildPageMetadata(start, await publicOrigin()) : {};
}

export default async function HomePage() {
  // The studio's start page, if it has one.
  const start = await getStartPage();
  if (start) {
    return <PublicPageView slug={start.page.slug} initial={start} />;
  }

  // Single-Mode: direkt durchleiten.
  if (MODE === "single") {
    redirect("/login");
  }

  // Multi-Mode: Host inspizieren um zu entscheiden, ob wir auf der
  // Apex-Domain oder einer Tenant-Subdomain sind.
  const headerList = await headers();
  const host = (headerList.get("host") ?? "").split(":")[0].toLowerCase();
  const isApex = isApexHost(host);

  // Tenant-Subdomain: Tenant ist via Host bekannt, direkt zu Login.
  if (!isApex) {
    redirect("/login");
  }

  // Apex: render the tenant picker. Form submit redirects to the subdomain.
  //
  // NOTE: this is a server component (it awaits headers()), so useT() is not
  // available and the copy below stays hardcoded German. Localising it needs
  // the locale resolved server-side from the cookie rather than the client
  // provider — worth doing, but a separate change.
  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-surface-canvas">
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
      />

      <div className="relative max-w-md w-full space-y-8 animate-fade-in">
        <header className="space-y-3">
          <div className="text-ui-xs font-medium text-accent uppercase tracking-[0.15em]">
            Lumio
          </div>
          <h1 className="text-display-xl font-medium tracking-tight text-ink-primary">
            Foto- &amp; Video-Sharing
            <br />
            <span className="text-ink-secondary">für Profis.</span>
          </h1>
          <p className="text-ui-lg text-ink-tertiary leading-relaxed">
            Schnelles Proofing, Auswahl und Auslieferung von Shootings.
          </p>
        </header>

        <TenantPicker domainBase={DOMAIN_BASE} />

        <div className="flex gap-4 text-ui-sm text-ink-tertiary justify-center">
          <Link
            href="https://lumio-app.de"
            className="hover:text-ink-secondary"
          >
            Self-hosted Version
          </Link>
          <span>·</span>
          <a
            href="https://github.com/markusthiel/lumio"
            className="hover:text-ink-secondary"
          >
            Quellcode
          </a>
        </div>
      </div>
    </main>
  );
}
