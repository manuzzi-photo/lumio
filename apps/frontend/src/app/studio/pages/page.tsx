"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, type StudioLandingPageListItem } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
import { DialogActions, Modal } from "@/components/ui/Modal";
import { useErrorText } from "@/lib/error-i18n";
import { useFormat, useT } from "@/lib/i18n";

export default function PagesListPage() {
  const t = useT();
  const fmt = useFormat();
  const errText = useErrorText();
  const router = useRouter();
  const [pages, setPages] = useState<StudioLandingPageListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listPages()
      .then((r) => alive && setPages(r.pages))
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(
          err instanceof ApiError && err.status === 403
            ? t("pages.forbidden")
            : errText(err, t("pages.loadFailed"))
        );
        setPages([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pages === null) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: t("brandingsList.breadcrumbStudio"), href: "/studio" },
          { label: t("pages.breadcrumb") },
        ]}
        title={t("pages.title")}
        description={t("pages.description")}
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            {t("pages.newPage")}
          </Button>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-5xl">
        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {pages.length === 0 && !error ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <div className="text-ink-tertiary text-ui">{t("pages.empty")}</div>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-ui-sm font-medium text-accent hover:text-accent-hover transition-colors duration-motion"
            >
              {t("pages.createFirst")}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pages.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/studio/pages/${p.id}`}
                  className="block rounded-lg border border-line-subtle bg-surface-raised hover:border-line-strong hover:shadow-sm transition p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium min-w-0 truncate">{p.title}</div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.isStudioDefault && (
                        <span className="text-[10px] font-medium uppercase tracking-wider bg-semantic-success/15 text-semantic-success px-1.5 py-0.5 rounded">
                          {t("pages.startPageBadge")}
                        </span>
                      )}
                      <span className="text-[10px] font-medium uppercase tracking-wider bg-surface-sunken text-ink-secondary px-1.5 py-0.5 rounded">
                        {t(`pages.access.${p.access}`)}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-ink-tertiary font-mono truncate">
                    {p.isStudioDefault ? "/" : `/p/${p.slug}`}
                  </div>
                  <div className="text-xs text-ink-tertiary">
                    {t(
                      p.galleryCount === 1
                        ? "pages.visibleCountSg"
                        : "pages.visibleCountPl",
                      { visible: p.visibleCount, total: p.galleryCount }
                    )}
                    {" · "}
                    {fmt.date(p.updatedAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreatePageDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            router.push(`/studio/pages/${id}`);
          }}
        />
      )}
    </>
  );
}

function CreatePageDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const errText = useErrorText();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { page } = await api.createPage({ title: title.trim() });
      onCreated(page.id);
    } catch (err) {
      setError(errText(err, t("common.error")));
      setPending(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="create-page-title">
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 id="create-page-title" className="text-lg font-semibold">
          {t("pages.newPage")}
        </h2>
        <input
          required
          autoFocus
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("pages.titlePlaceholder")}
          aria-label={t("pages.titleLabel")}
          className="w-full rounded-md border border-line-subtle bg-surface-raised px-3 py-2 text-sm"
        />
        <p className="text-xs text-ink-tertiary leading-relaxed">
          {t("pages.createHint")}
        </p>
        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
            {pending ? t("common.creating") : t("common.create")}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}
