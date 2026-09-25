"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, type StudioLandingPage, type StudioPageGallery } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import {
  LandingPageAccess,
  LandingPageAddress,
  LandingPageDetails,
} from "@/components/studio/LandingPageSettings";
import { LandingPageGalleries } from "@/components/studio/LandingPageGalleries";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/dialogs";
import { useErrorText } from "@/lib/error-i18n";
import { useT } from "@/lib/i18n";

export default function PageEditorPage() {
  const t = useT();
  const errText = useErrorText();
  const confirm = useConfirm();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [page, setPage] = useState<StudioLandingPage | null>(null);
  const [items, setItems] = useState<StudioPageGallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getPage(id);
      setPage(res.page);
      setItems(res.galleries);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        router.replace("/studio/pages");
        return;
      }
      setError(errText(err, t("pages.loadFailed")));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (!page) return;
    const origin = window.location.origin;
    const ok = await confirm({
      title: t("pages.deleteConfirmTitle", { title: page.title }),
      message: page.isStudioDefault
        ? t("pages.deleteConfirmStart", { origin: `${origin}/` })
        : t("pages.deleteConfirmMessage"),
      confirmLabel: t("pages.delete"),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deletePage(page.id);
      router.replace("/studio/pages");
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        {t("common.loading")}
      </div>
    );
  }
  if (!page) {
    return (
      <div className="px-6 py-10 text-ui text-semantic-danger">
        {error ?? t("pages.loadFailed")}
      </div>
    );
  }

  const publicHref = page.isStudioDefault ? "/" : `/p/${page.slug}`;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: t("brandingsList.breadcrumbStudio"), href: "/studio" },
          { label: t("pages.breadcrumb"), href: "/studio/pages" },
          { label: page.title },
        ]}
        title={page.title}
        description={t("pages.editorDescription")}
        actions={
          <>
            <a href={publicHref} target="_blank" rel="noopener noreferrer">
              <Button>{t("pages.openPage")}</Button>
            </a>
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {t("pages.delete")}
            </Button>
          </>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-4xl">
        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <LandingPageGalleries pageId={page.id} items={items} onChanged={load} />
        <LandingPageDetails page={page} onSaved={load} />
        <LandingPageAccess page={page} onSaved={load} />
        <LandingPageAddress page={page} onSaved={load} />
      </div>
    </>
  );
}
