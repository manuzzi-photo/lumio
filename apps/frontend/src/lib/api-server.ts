/**
 * Server-side API-Helper für Next.js Server Components / Metadata.
 *
 * Im Gegensatz zu lib/api.ts (client-seitig, nutzt Browser-Cookies):
 * hier laufen wir auf dem Node-Server beim Render-Schritt. Kein Cookie,
 * kein Browser. Wir reden direkt mit dem API-Container.
 *
 * INTERNAL_API_URL: die API im Compose-Netz, ohne Umweg über Caddy+TLS.
 *
 * Der Default ist WICHTIG und war lange der Fehler hier: früher fiel
 * das auf NEXT_PUBLIC_API_URL zurück, und das ist im Standard-Setup
 * bewusst LEER ("same-origin" — der Browser löst relative URLs gegen
 * den eigenen Host auf). Im Browser stimmt das. generateMetadata läuft
 * aber in Node, und dort wirft `fetch("/api/v1/g/x")` schlicht
 * "Failed to parse URL". Ergebnis: Titel und Open-Graph-Tags fielen bei
 * JEDER Standard-Installation auf den generischen Fallback zurück —
 * geteilte Galerie-Links zeigten in WhatsApp/Slack weder Titel noch
 * Hero-Bild.
 */
import type { PublicLandingPage } from "@/lib/api";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  "http://lumio_api:3001";

export interface ServerGalleryMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  branding?: { name: string } | null;
  /** Oeffentlicher Studio-Name. Nicht branding.name — das ist die
   *  interne Profilbezeichnung ("Standard", "Hochzeit-Style"). */
  studioName?: string | null;
  faviconUrl?: string | null;
  header?: {
    heroImageUrl: string | null;
    eventLogoUrl: string | null;
    welcomeMarkdown: string | null;
    overlayColor: string | null;
    backgroundColor: string | null;
  };
}

export async function fetchPublicGallery(
  slug: string
): Promise<{ gallery: ServerGalleryMeta } | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/api/v1/g/${slug}`, {
      // Server-side fetch — wir wollen frische Daten, kein Browser-Cache,
      // aber Next.js Static-Render kann das hier prerendern wenn die
      // Galerie nicht zu oft ändert.
      next: { revalidate: 60 }, // 1 min — Titel/Hero ändern selten
    });
    if (!res.ok) {
      console.warn(
        `[metadata] gallery fetch ${slug}: HTTP ${res.status} von ${INTERNAL_API_URL}`
      );
      return null;
    }
    return await res.json();
  } catch (err) {
    // Bewusst laut: der Aufrufer faengt das Ergebnis mit .catch(() => null)
    // ab und rendert stillschweigend einen generischen Titel. Genau das
    // hat jahrelang verdeckt, dass die URL gar nicht aufloesbar war —
    // sichtbar war es nur an einem falschen Browser-Tab.
    console.warn(
      `[metadata] gallery fetch ${slug} fehlgeschlagen (base: ${INTERNAL_API_URL})`,
      err
    );
    return null;
  }
}

/**
 * Macht aus einem (möglicherweise relativen) Asset-Pfad einen absoluten
 * URL, der von Crawlern (WhatsApp-Bot, Slack-Unfurler, ...) abgerufen
 * werden kann.
 *
 * Akzeptiert sowohl absolute URLs (Presigned-S3 vom Backend für
 * heroFileId-Auflösung) als auch relative API-Pfade (`/api/v1/g/...`
 * für hochgeladene Assets / Logos).
 *
 * Die Origin kommt aus dem eingehenden Request-Host, nicht aus einer
 * Env-Variable: im Multi-Tenant-Betrieb ist sie pro Tenant verschieden
 * (studio-a.example.com vs. eine Custom-Domain), und im Standard-Setup
 * ist NEXT_PUBLIC_API_URL bewusst leer — ein relativer OG-Image-Pfad
 * ist fuer einen Crawler aber wertlos.
 *
 * `publicOrigin()` muss der Aufrufer uebergeben, weil headers() nur in
 * einem Request-Scope funktioniert.
 */
export function fetchAssetAbsolute(
  maybeRelative: string,
  origin: string
): string {
  if (/^https?:\/\//.test(maybeRelative)) return maybeRelative;
  const base = origin.replace(/\/+$/, "");
  return `${base}${maybeRelative}`;
}

/**
 * Oeffentliche Origin des aktuellen Requests, fuer absolute URLs in
 * Metadaten. Bevorzugt die Forwarded-Header, die Caddy setzt.
 */
export async function publicOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  // Letzter Ausweg: die konfigurierte Public-URL, falls gesetzt.
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
}

// -----------------------------------------------------------------------------
// Landing pages
// -----------------------------------------------------------------------------
// Die API loest den Tenant aus dem Host-Header des Requests auf (Custom-Domain,
// Subdomain). Ein Server-Side-Fetch geht aber direkt an den API-Container und
// hat deshalb dessen Host. Fuer die Startseite unter / ist das fatal: ohne den
// Host des Besuchers weiss die API nicht, welches Studio gemeint ist.
//
// fetch() erlaubt es in Node nicht, den Host-Header zu setzen (undici ignoriert
// ihn stillschweigend), darum hier node:http.

interface ApiResponse {
  status: number;
  json: unknown;
}

async function getJsonForHost(
  path: string,
  host: string
): Promise<ApiResponse> {
  const base = new URL(INTERNAL_API_URL);
  const transport =
    base.protocol === "https:" ? await import("node:https") : await import("node:http");
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: base.hostname,
        port: base.port || undefined,
        path: base.pathname.replace(/\/+$/, "") + path,
        method: "GET",
        headers: { accept: "application/json", ...(host ? { host } : {}) },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: null });
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** Host des Besuchers, so wie ihn der Reverse-Proxy durchreicht. */
export async function visitorHost(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
}

/**
 * Die Startseite des Studios (die Page, die unter / ausgeliefert wird), oder
 * null: keine gesetzt, Feature aus, Studio offline oder API nicht erreichbar.
 * Null heisst fuer den Aufrufer immer "bleib beim Redirect auf /login".
 */
export async function fetchStartPage(): Promise<PublicLandingPage | null> {
  try {
    const res = await getJsonForHost("/api/v1/p", await visitorHost());
    return res.status === 200 ? (res.json as PublicLandingPage) : null;
  } catch (err) {
    console.warn(`[start-page] fetch fehlgeschlagen (base: ${INTERNAL_API_URL})`, err);
    return null;
  }
}

export interface ServerPageResult {
  status: number;
  data: PublicLandingPage | null;
}

/** Eine Page per Slug, fuer generateMetadata und den Redirect der Startseite. */
export async function fetchPublicPage(slug: string): Promise<ServerPageResult> {
  try {
    const res = await getJsonForHost(
      `/api/v1/p/${encodeURIComponent(slug)}`,
      await visitorHost()
    );
    return {
      status: res.status,
      data: res.status === 200 ? (res.json as PublicLandingPage) : null,
    };
  } catch (err) {
    console.warn(`[metadata] page fetch ${slug} fehlgeschlagen`, err);
    return { status: 0, data: null };
  }
}
