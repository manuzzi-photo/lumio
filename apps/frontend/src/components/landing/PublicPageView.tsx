"use client";

/**
 * A landing page as a visitor sees it: /p/<slug>, and the studio's start page
 * on "/".
 *
 * Themed by the same GalleryShell as the client galleries, so the studio's
 * delivered content keeps one look. A page LISTS galleries: a card links to
 * /g/<slug> and that gallery decides for itself who may open it (password,
 * expiry, ...). What a card shows is decided by the API; this component only
 * draws what it is given.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  api,
  ApiError,
  type PublicLandingPage,
  type PublicPageCard,
} from "@/lib/api";
import { GalleryShell, isLightColor } from "@/components/gallery/GalleryShell";
import { useFormat, useT } from "@/lib/i18n";

/** Height of a card's picture. Width follows the aspect ratio, like the
 *  justified grid inside a gallery. */
const ROW_HEIGHT = 240;
/** Aspect ratio of a card without a picture. */
const PLACEHOLDER_RATIO = 3 / 2;

interface Props {
  slug: string;
  /** Data already fetched on the server (the start page). Without it the
   *  component fetches on mount. */
  initial?: PublicLandingPage | null;
}

export function PublicPageView({ slug, initial }: Props) {
  const t = useT();
  const [data, setData] = useState<PublicLandingPage | null>(initial ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "unavailable">(
    initial ? "ready" : "loading"
  );

  const load = useCallback(async () => {
    try {
      setData(await api.getPublicPage(slug));
      setStatus("ready");
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 503 ? "unavailable" : "notfound");
    }
  }, [slug]);

  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  if (status !== "ready" || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas px-6">
        <div className="text-ui text-ink-tertiary text-center">
          {status === "loading"
            ? t("common.loading")
            : status === "unavailable"
              ? t("publicPage.unavailable")
              : t("publicPage.notFound")}
        </div>
      </div>
    );
  }

  const { page, galleries } = data;
  const light = isLightColor(page.branding?.primaryColor ?? "#0e0e10");

  return (
    <GalleryShell
      branding={page.branding}
      faviconUrl={page.faviconUrl}
      footerExtra={
        page.isDefault ? (
          <Link href="/login" className="hover:underline shrink-0">
            {t("publicPage.studioLogin")}
          </Link>
        ) : null
      }
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 pt-12 sm:pt-16 pb-6">
        <header className="mb-10">
          <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight text-center">
            {page.title}
          </h1>
          {page.introMarkdown && (
            <div
              className={`mx-auto mt-5 max-w-2xl text-center prose ${
                light ? "" : "prose-invert"
              } prose-sm sm:prose-base`}
            >
              {/* The page title is the h1: headings in the intro start at h2. */}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{ h1: "h2" }}
              >
                {page.introMarkdown}
              </ReactMarkdown>
            </div>
          )}
        </header>

        {page.locked ? (
          <UnlockForm slug={slug} onUnlocked={load} />
        ) : galleries.length === 0 ? (
          <p
            className="text-center text-ui py-16"
            style={{ color: "var(--brand-fg-subtle)" }}
          >
            {t("publicPage.empty")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-8">
            {galleries.map((card) => (
              <Card key={card.slug} card={card} />
            ))}
            {/* Keeps the last row from stretching across the full width: it
                takes almost all of the free space there. */}
            <i className="block" style={{ flexGrow: 10000 }} aria-hidden="true" />
          </div>
        )}
      </div>
    </GalleryShell>
  );
}

// ---------------------------------------------------------------------------
// A gallery card
// ---------------------------------------------------------------------------
function Card({ card }: { card: PublicPageCard }) {
  const t = useT();
  const fmt = useFormat();

  // Clamp so that a panorama or a very tall picture does not make a row
  // absurdly wide or narrow.
  const raw =
    card.cover?.width && card.cover?.height
      ? card.cover.width / card.cover.height
      : PLACEHOLDER_RATIO;
  const ratio = Math.min(2.4, Math.max(0.6, raw));

  const meta = [
    fmt.date(card.createdAt),
    card.fileCount !== null
      ? t(card.fileCount === 1 ? "pages.filesSg" : "pages.filesPl", {
          count: card.fileCount,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/g/${card.slug}`}
      prefetch={false}
      className="group block"
      // flex-grow is scaled up: with the sum of the grow factors of a row
      // below 1, the browser hands out only that fraction of the free space,
      // so a lone portrait card would not fill its row on a narrow screen.
      style={{ flexBasis: `${ROW_HEIGHT * ratio}px`, flexGrow: ratio * 100 }}
    >
      <div
        className="relative overflow-hidden rounded"
        style={{ height: ROW_HEIGHT, background: "var(--brand-surface)" }}
      >
        {card.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.cover.url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : card.protected ? (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ color: "var(--brand-fg-subtle)" }}
          >
            <LockIcon className="w-10 h-10" />
          </div>
        ) : null}
        {card.protected && card.cover && (
          <span
            className="absolute top-2 right-2 rounded-full p-1.5 bg-black/55 text-white"
            title={t("publicPage.protectedLabel")}
          >
            <LockIcon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      <div className="pt-2.5 space-y-0.5">
        <div className="text-ui font-medium truncate">
          {card.title}
          {card.protected && (
            <span className="sr-only"> ({t("publicPage.protectedLabel")})</span>
          )}
        </div>
        <div className="text-ui-xs" style={{ color: "var(--brand-fg-subtle)" }}>
          {meta}
        </div>
        {card.description && (
          <p
            className="text-ui-xs line-clamp-2 leading-relaxed"
            style={{ color: "var(--brand-fg-muted)" }}
          >
            {card.description}
          </p>
        )}
      </div>
    </Link>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Password page
// ---------------------------------------------------------------------------
function UnlockForm({
  slug,
  onUnlocked,
}: {
  slug: string;
  onUnlocked: () => Promise<void>;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.unlockPage(slug, password);
      await onUnlocked();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "invalid_password"
          ? t("gallery.passwordIncorrect")
          : t("gallery.requestFailed")
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex justify-center py-8 animate-fade-in">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-5 bg-white/[0.03] border border-white/10 rounded-md p-7 backdrop-blur"
      >
        <div className="text-ui-sm opacity-75">{t("publicPage.locked")}</div>
        <div className="space-y-1.5">
          <label htmlFor="page-pw" className="text-ui-sm font-medium opacity-90 block">
            {t("gallery.password")}
          </label>
          <input
            id="page-pw"
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("gallery.passwordPlaceholder")}
            className="w-full rounded bg-white/5 border border-white/15 hover:border-white/30 focus:border-brand-accent focus:bg-white/10 px-3 h-10 text-ui placeholder:opacity-40 focus:outline-none transition-colors duration-motion"
          />
        </div>
        {error && (
          <div className="text-ui-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full h-10 bg-brand-accent text-brand-accent-contrast text-ui font-medium rounded hover:opacity-90 disabled:opacity-50 transition-opacity duration-motion"
        >
          {pending ? t("gallery.unlockChecking") : t("publicPage.open")}
        </button>
      </form>
    </div>
  );
}
