"use client";

/**
 * "Pages" section of a gallery's Share tab: on which landing pages the gallery
 * appears, and a quick way to put it on one, including "New page..." which
 * creates a link-only page and puts the gallery on it in one step.
 *
 * Without this nobody could tell, before archiving or deleting a gallery, that
 * it is still embedded on a page a client is looking at.
 *
 * Only for owner and admin, and only while the landing_pages feature is on.
 * When the API says no (403/404) the section simply does not render.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import {
  api,
  ApiError,
  type GalleryPageRef,
  type GalleryStatus,
} from "@/lib/api";
import { Button } from "@/components/ui";
import { useErrorText } from "@/lib/error-i18n";
import { useT } from "@/lib/i18n";

/**
 * Titles of the pages a gallery is on, for the archive and delete dialogs.
 * Empty when there are none, and also when the caller may not know (a member,
 * the feature switched off, a failed request): the dialogs then behave as they
 * always did.
 */
export async function pagesHoldingGallery(
  galleryId: string
): Promise<GalleryPageRef[]> {
  try {
    const { pages } = await api.listGalleryPages(galleryId);
    return pages.filter((p) => p.contains);
  } catch {
    return [];
  }
}

interface Props {
  galleryId: string;
  status: GalleryStatus;
  publicAccess: boolean;
  hasPassword: boolean;
  /** Owner or admin. Everyone else does not see the section at all. */
  canManage: boolean;
}

export function GalleryPagesSection({
  galleryId,
  status,
  publicAccess,
  hasPassword,
  canManage,
}: Props) {
  const t = useT();
  const errText = useErrorText();
  const [pages, setPages] = useState<GalleryPageRef[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPages((await api.listGalleryPages(galleryId)).pages);
    } catch (err) {
      // 403 (member) and 404 (feature off) are "not for you / not here", not
      // an error worth showing.
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setHidden(true);
      } else {
        setError(errText(err, t("galleryPages.loadFailed")));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  if (!canManage || hidden) return null;

  async function toggle(page: GalleryPageRef) {
    setBusyId(page.id);
    setError(null);
    try {
      if (page.contains) await api.removePageGallery(page.id, galleryId);
      else await api.addPageGallery(page.id, galleryId);
      await load();
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
    } finally {
      setBusyId(null);
    }
  }

  async function createPage(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      await api.createPage({ title, galleryId });
      setNewTitle("");
      await load();
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
    } finally {
      setCreating(false);
    }
  }

  const on = (pages ?? []).filter((p) => p.contains);

  // Why the gallery may not show up on a page right now.
  const notes: string[] = [];
  if (status !== "live") notes.push(t("galleryPages.noteNotLive"));
  if (!publicAccess) notes.push(t("galleryPages.noteLinksOnly"));

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{t("galleryPages.heading")}</h2>
          <p className="text-xs text-ink-tertiary mt-0.5">{t("galleryPages.desc")}</p>
        </div>
        <Button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {t("galleryPages.addButton")}
        </Button>
      </div>

      {pages !== null && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {on.length === 0 ? (
            <span className="text-ink-tertiary">{t("galleryPages.onNone")}</span>
          ) : (
            <>
              <span className="text-ink-tertiary">{t("galleryPages.onPages")}</span>
              {on.map((p) => (
                <Link
                  key={p.id}
                  href={`/studio/pages/${p.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface-base px-2.5 py-1 hover:border-line-strong"
                >
                  {p.title}
                  {p.isStudioDefault && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-semantic-success">
                      {t("pages.startPageBadge")}
                    </span>
                  )}
                </Link>
              ))}
            </>
          )}
        </div>
      )}

      {open && pages !== null && (
        <div className="rounded-md border border-line-subtle bg-surface-base p-3 space-y-3">
          {pages.length > 0 && (
            <ul className="space-y-1.5">
              {pages.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.contains}
                      disabled={busyId !== null}
                      onChange={() => toggle(p)}
                    />
                    <span className="truncate">{p.title}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-ink-tertiary shrink-0">
                      {t(`pages.access.${p.access}`)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={createPage} className="flex gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={120}
              placeholder={t("galleryPages.newPagePlaceholder")}
              aria-label={t("galleryPages.newPage")}
              className="flex-1 min-w-0 rounded-md border border-line-subtle bg-surface-raised px-3 py-1.5 text-sm"
            />
            <Button type="submit" variant="primary" disabled={creating || !newTitle.trim()}>
              {creating ? t("common.creating") : t("galleryPages.newPage")}
            </Button>
          </form>
          <p className="text-xs text-ink-tertiary leading-relaxed">
            {t("galleryPages.newPageHint")}
          </p>
        </div>
      )}

      {notes.map((note) => (
        <div
          key={note}
          className="rounded-md bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed"
        >
          {note}
        </div>
      ))}
      {/* What a page makes public. For a gallery without a password that is
          more than a title. */}
      <div className="rounded-md bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed">
        {hasPassword
          ? t("galleryPages.exposureProtected")
          : t("galleryPages.exposureOpen")}
      </div>

      {error && <p className="text-sm text-semantic-danger">{error}</p>}
    </section>
  );
}
