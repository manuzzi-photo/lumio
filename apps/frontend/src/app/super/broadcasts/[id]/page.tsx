"use client";

/**
 * Super-Admin — Broadcast-Detail
 *
 * Zeigt den Status eines einzelnen Broadcasts mit Live-Polling der
 * Counts. Bei 'sending' wird alle 2s gepollt; bei 'finished'/'failed'
 * stoppt das Polling.
 *
 * Aktionen:
 *  - Loeschen (nur bei pending/failed/cancelled)
 *  - HTML-Vorschau des versendeten Inhalts
 */

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { useFormat, useT} from "@/lib/i18n";

type Response = Awaited<ReturnType<typeof api.superGetBroadcast>>;

export default function BroadcastDetailPage() {
  return (
    <SuperShell>
      <Detail />
    </SuperShell>
  );
}

function Detail() {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const r = await api.superGetBroadcast(id);
        if (cancelled) return;
        setData(r);
        // Polling nur solange noch im Versand
        if (r.broadcast.status !== "sending" && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Fehler");
      }
    }
    void load();
    intervalId = setInterval(load, 2000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [id]);

  async function deleteBroadcast() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    try {
      await api.superDeleteBroadcast(id);
      router.push("/super/broadcasts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  if (!data) {
    return (
      <div className="px-4 sm:px-8 py-6 max-w-4xl">
        {error ? (
          <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
            {error}
          </div>
        ) : (
          <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>
        )}
      </div>
    );
  }

  const b = data.broadcast;
  const progress =
    b.totalRecipients > 0
      ? Math.floor(
          ((b.sentCount + b.failedCount + b.optedOutSkippedCount) /
            b.totalRecipients) *
            100
        )
      : 0;
  const canDelete = b.status !== "sending" && b.status !== "finished";

  return (
    <div className="px-4 sm:px-8 py-6 max-w-4xl">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => router.push("/super/broadcasts")}
          className="text-ui-xs text-ink-tertiary hover:text-ink-secondary"
        >
          {t("super.bdBack")}
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold mb-1">{b.subject}</h1>
          <div className="text-ui-sm text-ink-tertiary">
            {b.audience} ·{" "}
            {new Date(b.createdAt).toLocaleString(fmt.bcp47, {
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}von {b.createdByEmail}
          </div>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={deleteBroadcast}
            className={
              confirmingDelete
                ? "text-sm px-3 py-2 rounded-md border border-semantic-danger text-semantic-danger font-medium"
                : "text-sm px-3 py-2 rounded-md border border-line-subtle text-ink-secondary hover:text-semantic-danger hover:bg-surface-sunken"
            }
          >
            {confirmingDelete ? t("super.bdConfirmDelete") : t("super.tdDeleteNote")}
          </button>
        )}
      </div>

      {/* Status-Karten */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label={t("super.bdStatus")} value={b.status} tone={statusTone(b.status)} mono />
        <StatCard
          label={t("super.bdTotalRecipients")}
          value={b.totalRecipients.toLocaleString(fmt.bcp47)}
        />
        <StatCard
          label={t("super.bdSent")}
          value={b.sentCount.toLocaleString(fmt.bcp47)}
          tone="success"
        />
        <StatCard
          label={t("super.bdErrors")}
          value={b.failedCount.toLocaleString(fmt.bcp47)}
          tone={b.failedCount > 0 ? "danger" : "neutral"}
        />
      </div>

      {b.status === "sending" && (
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm text-ink-secondary">{t("super.bdProgress")}</span>
            <span className="text-sm text-ink-tertiary">{progress}%</span>
          </div>
          <div className="h-2 bg-surface-sunken rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {b.optedOutSkippedCount > 0 && (
        <div className="text-sm text-ink-tertiary mb-4">
          {b.optedOutSkippedCount.toLocaleString(fmt.bcp47)} User wurden
          übersprungen (Opt-Out aktiv).
        </div>
      )}

      {b.errorMessage && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4">
          <div className="text-xs font-medium text-semantic-danger mb-1">
            {t("super.bdFirstError")}
          </div>
          <div className="text-sm text-ink-secondary font-mono whitespace-pre-wrap">
            {b.errorMessage}
          </div>
        </div>
      )}

      {/* HTML-Vorschau */}
      <h2 className="text-lg font-semibold mb-2">{t("super.bdSentContent")}</h2>
      <div className="rounded-md border border-line-subtle bg-white overflow-hidden mb-6">
        <iframe
          title={t("super.bdMailPreview")}
          srcDoc={b.bodyHtml}
          className="w-full"
          style={{ height: "60vh", border: "none" }}
        />
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-tertiary">
          {t("super.bdMarkdownSource")}
        </summary>
        <pre className="mt-2 p-3 bg-surface-sunken rounded text-xs font-mono whitespace-pre-wrap">
          {b.bodyMarkdown}
        </pre>
      </details>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
  mono = false,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  mono?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-semantic-success"
      : tone === "warning"
        ? "text-semantic-warning"
        : tone === "danger"
          ? "text-semantic-danger"
          : "text-ink-primary";
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </div>
      <div
        className={`text-2xl font-semibold mt-2 ${toneClass} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function statusTone(s: string): "neutral" | "success" | "warning" | "danger" {
  switch (s) {
    case "finished":
      return "success";
    case "sending":
    case "pending":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}
