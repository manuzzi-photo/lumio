"use client";

/**
 * The galleries on a landing page: manual order (drag and drop, or the keyboard
 * on the handle), a title for this page only, the preview opt-in for password
 * galleries, and removal. "Add gallery" opens a picker.
 *
 * What a visitor actually sees is decided by the API (services/landing-pages.ts).
 * This list shows each gallery with the reason when it is NOT shown right now
 * (draft, archived, expired, needs a share link), so nothing disappears
 * silently.
 */
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  api,
  type Gallery,
  type StudioPageGallery,
} from "@/lib/api";
import { Button } from "@/components/ui";
import { DialogActions, Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/dialogs";
import { useErrorText } from "@/lib/error-i18n";
import { useT } from "@/lib/i18n";

/** Same bound as the API (PAGE_GALLERY_LIMIT). */
const PAGE_GALLERY_LIMIT = 200;

/** Existing status labels, shared with the gallery list. */
const STATUS_KEY = {
  draft: "studio.statusDraft",
  live: "studio.statusLive",
  archived: "studio.statusArchived",
} as const;

const BADGE =
  "text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded";

interface Props {
  pageId: string;
  items: StudioPageGallery[];
  /** Reload the page after a change. */
  onChanged: () => Promise<void>;
}

export function LandingPageGalleries({ pageId, items, onChanged }: Props) {
  const t = useT();
  const errText = useErrorText();
  // Local copy so a drag feels immediate; the server order is the truth again
  // as soon as the list reloads.
  const [order, setOrder] = useState(items);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => setOrder(items), [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const ids = useMemo(() => order.map((i) => i.galleryId), [order]);

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((i) => i.galleryId === e.active.id);
    const to = order.findIndex((i) => i.galleryId === e.over!.id);
    if (from < 0 || to < 0) return;

    const previous = order;
    const next = arrayMove(order, from, to);
    setOrder(next);
    setError(null);
    try {
      await api.reorderPageGalleries(pageId, next.map((i) => i.galleryId));
    } catch (err) {
      setOrder(previous);
      setError(errText(err, t("pages.saveFailed")));
    }
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{t("pages.galleriesHeading")}</h2>
          <p className="text-xs text-ink-tertiary mt-0.5">{t("pages.galleriesDesc")}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setAdding(true)}
          disabled={order.length >= PAGE_GALLERY_LIMIT}
        >
          {t("pages.addGallery")}
        </Button>
      </div>

      <div className="rounded-md bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed">
        {t("pages.exposureWarning")}
      </div>

      {order.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-8 text-center text-sm text-ink-tertiary">
          {t("pages.noGalleries")}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {order.map((item) => (
                <GalleryRow
                  key={item.galleryId}
                  pageId={pageId}
                  item={item}
                  onChanged={onChanged}
                  onError={setError}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {error && <p className="text-sm text-semantic-danger">{error}</p>}

      {adding && (
        <AddGalleryDialog
          pageId={pageId}
          onPage={new Set(ids)}
          full={order.length >= PAGE_GALLERY_LIMIT}
          onClose={() => setAdding(false)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One gallery on the page
// ---------------------------------------------------------------------------
function GalleryRow({
  pageId,
  item,
  onChanged,
  onError,
}: {
  pageId: string;
  item: StudioPageGallery;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const errText = useErrorText();
  const confirm = useConfirm();
  const g = item.gallery;
  const [title, setTitle] = useState(item.titleOverride ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => setTitle(item.titleOverride ?? ""), [item.titleOverride]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.galleryId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError(errText(err, t("pages.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    const next = title.trim();
    if (next === (item.titleOverride ?? "")) return;
    await run(() =>
      api.updatePageGallery(pageId, item.galleryId, { titleOverride: next || null })
    );
  }

  async function remove() {
    const ok = await confirm({
      message: t("pages.removeConfirm", { title: item.titleOverride ?? g.title }),
      confirmLabel: t("pages.remove"),
      destructive: true,
    });
    if (!ok) return;
    await run(() => api.removePageGallery(pageId, item.galleryId));
  }

  const notShown = notShownText(t, item);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-md border bg-surface-base p-3 flex gap-3 ${
        item.ineligibleReason ? "border-line-subtle opacity-80" : "border-line-subtle"
      }`}
    >
      <button
        type="button"
        aria-label={t("pages.dragHandle")}
        title={t("pages.dragHandle")}
        className="self-start mt-1 text-ink-tertiary hover:text-ink-primary cursor-grab active:cursor-grabbing touch-none px-1"
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>

      <div className="w-16 h-16 shrink-0 rounded-sm overflow-hidden bg-surface-sunken border border-line-subtle">
        {g.coverThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.coverThumbUrl} alt="" className="w-full h-full object-cover" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{g.title}</span>
          {g.protected && (
            <span className={`${BADGE} bg-surface-sunken text-ink-secondary`}>
              {t("pages.badgeProtected")}
            </span>
          )}
          {notShown && (
            <span className={`${BADGE} bg-semantic-warning/15 text-semantic-warning`}>
              {notShown}
            </span>
          )}
          <span className="text-xs text-ink-tertiary">
            {t(g.fileCount === 1 ? "pages.filesSg" : "pages.filesPl", {
              count: g.fileCount,
            })}
          </span>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          maxLength={120}
          disabled={busy}
          placeholder={t("pages.titleOnPage")}
          aria-label={t("pages.titleOnPage")}
          className="w-full rounded-md border border-line-subtle bg-surface-raised px-2.5 py-1.5 text-xs disabled:opacity-50"
        />

        {g.protected && (
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={item.previewOptIn}
              disabled={busy}
              onChange={(e) =>
                run(() =>
                  api.updatePageGallery(pageId, item.galleryId, {
                    previewOptIn: e.target.checked,
                  })
                )
              }
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{t("pages.previewToggle")}</span>
              <span className="block text-ink-tertiary leading-relaxed">
                {t("pages.previewToggleHint")}
              </span>
            </span>
          </label>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={remove}
        disabled={busy}
        className="self-start"
      >
        {t("pages.remove")}
      </Button>
    </li>
  );
}

/** Why a gallery is not shown to visitors right now, or null if it is. */
function notShownText(
  t: ReturnType<typeof useT>,
  item: StudioPageGallery
): string | null {
  switch (item.ineligibleReason) {
    case "not_live":
      return item.gallery.status === "archived"
        ? t("pages.notShownArchived")
        : t("pages.notShownDraft");
    case "expired":
      return t("pages.notShownExpired");
    case "links_only":
      return t("pages.notShownLinksOnly");
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// "Add gallery" picker
// ---------------------------------------------------------------------------
function AddGalleryDialog({
  pageId,
  onPage,
  full,
  onClose,
  onChanged,
}: {
  pageId: string;
  onPage: Set<string>;
  full: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const errText = useErrorText();
  const [galleries, setGalleries] = useState<Gallery[] | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listGalleries()
      .then((r) => alive && setGalleries(r.galleries))
      .catch((err) => alive && setError(errText(err, t("pages.loadFailed"))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (galleries ?? []).filter((g) => !q || g.title.toLowerCase().includes(q));
  }, [galleries, query]);

  async function add(galleryId: string) {
    setBusyId(galleryId);
    setError(null);
    try {
      await api.addPageGallery(pageId, galleryId);
      await onChanged();
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="add-gallery-title">
      <h2 id="add-gallery-title" className="text-lg font-semibold">
        {t("pages.addDialogTitle")}
      </h2>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("pages.searchPlaceholder")}
        aria-label={t("pages.searchPlaceholder")}
        className="mt-3 w-full rounded-md border border-line-subtle bg-surface-raised px-3 py-2 text-sm"
      />
      {full && (
        <p className="mt-2 text-xs text-semantic-warning">
          {t("pages.pageFull", { max: PAGE_GALLERY_LIMIT })}
        </p>
      )}

      <div className="mt-3 max-h-80 overflow-y-auto -mx-1 px-1">
        {galleries === null && !error ? (
          <p className="text-sm text-ink-tertiary py-6 text-center">{t("common.loading")}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-tertiary py-6 text-center">{t("pages.noMatches")}</p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {shown.map((g) => {
              const already = onPage.has(g.id);
              return (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{g.title}</div>
                    <div className="text-xs text-ink-tertiary">
                      {t(STATUS_KEY[g.status])}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => add(g.id)}
                    disabled={already || full || busyId !== null}
                  >
                    {already ? t("pages.alreadyAdded") : t("pages.add")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-semantic-danger">{error}</p>}
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          {t("common.done")}
        </Button>
      </DialogActions>
    </Modal>
  );
}
