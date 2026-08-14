"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type SuperJobsResponse,
  type JobFileRow,
  type JobZipRow,
  type JobWebhookRow,
} from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { useT } from "@/lib/i18n";

export default function SuperJobsPage() {
  return (
    <SuperShell>
      <JobsView />
    </SuperShell>
  );
}

function JobsView() {
  const t = useT();
  const [data, setData] = useState<SuperJobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.superGetJobs());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retryFile(id: string) {
    setBusyId(id);
    try {
      await api.superRetryFileJob(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function retryWebhook(id: string) {
    setBusyId(id);
    try {
      await api.superRetryWebhookJob(id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const c = data?.counts;
  const allClear =
    c && c.failedFiles + c.stuckFiles + c.failedZips + c.failedWebhooks === 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">{t("super.jobsTitle")}</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 px-4 rounded border border-line-subtle text-ui-sm hover:bg-surface-sunken"
        >
          {t("super.refresh")}
        </button>
      </div>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        {t("super.jobsSubtitle")}
      </p>

      {loading ? (
        <div className="text-ui text-ink-tertiary">{t("common.loading")}</div>
      ) : !data ? null : allClear ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
          <p className="text-ui text-ink-tertiary">
            {t("super.jobsAllClear")}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <CountCard label={t("super.jobsFailedFiles")} value={c!.failedFiles} />
            <CountCard label={t("super.jobsStuckFiles")} value={c!.stuckFiles} />
            <CountCard label={t("super.jobsFailedZips")} value={c!.failedZips} />
            <CountCard label={t("super.jobsFailedWebhooks")} value={c!.failedWebhooks} />
          </div>

          <FileSection
            title={t("super.jobsFailedFilesTitle")}
            rows={data.failedFiles}
            busyId={busyId}
            onRetry={retryFile}
          />
          <FileSection
            title={t("super.jobsStuckFilesTitle")}
            rows={data.stuckFiles}
            busyId={busyId}
            onRetry={retryFile}
          />
          <ZipSection rows={data.failedZips} />
          <WebhookSection
            rows={data.failedWebhooks}
            busyId={busyId}
            onRetry={retryWebhook}
          />
        </>
      )}
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-line-subtle rounded-md bg-surface-raised p-3">
      <div
        className={
          "text-2xl font-semibold tabular-nums " +
          (value > 0 ? "text-semantic-danger" : "text-ink-primary")
        }
      >
        {value}
      </div>
      <div className="text-ui-xs text-ink-tertiary mt-0.5">{label}</div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="text-ui font-semibold mb-3">{title}</h2>
      <div className="border border-line-subtle rounded-md bg-surface-raised overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

function When({ at }: { at: string }) {
  return (
    <span className="text-ink-tertiary text-ui-xs whitespace-nowrap">
      {new Date(at).toLocaleString()}
    </span>
  );
}

function RetryButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="h-7 px-3 rounded border border-line-subtle text-ui-xs hover:bg-surface-sunken disabled:opacity-50 whitespace-nowrap"
    >
      {busy ? "…" : "Neu starten"}
    </button>
  );
}

function FileSection({
  title,
  rows,
  busyId,
  onRetry,
}: {
  title: string;
  rows: JobFileRow[];
  busyId: string | null;
  onRetry: (id: string) => void;
}) {
  return (
    <Section title={title} count={rows.length}>
      <table className="w-full text-ui-sm">
        <tbody>
          {rows.map((f) => (
            <tr
              key={f.id}
              className="border-b border-line-subtle last:border-0 align-top"
            >
              <td className="px-3 py-2">
                <div className="break-all">{f.filename}</div>
                <div className="text-ink-tertiary text-ui-xs mt-0.5">
                  {f.tenant} · {f.gallery} · {f.kind}
                </div>
                {f.error && (
                  <div className="text-semantic-danger text-ui-xs mt-0.5 break-all">
                    {f.error}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <When at={f.at} />
              </td>
              <td className="px-3 py-2 text-right">
                <RetryButton
                  busy={busyId === f.id}
                  onClick={() => onRetry(f.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function ZipSection({ rows }: { rows: JobZipRow[] }) {
  const t = useT();
  return (
    <Section title={t("super.jobsFailedZipsTitle")} count={rows.length}>
      <table className="w-full text-ui-sm">
        <tbody>
          {rows.map((z) => (
            <tr
              key={z.id}
              className="border-b border-line-subtle last:border-0 align-top"
            >
              <td className="px-3 py-2">
                <div>
                  {z.tenant} · {z.gallery}
                </div>
                <div className="text-ink-tertiary text-ui-xs mt-0.5">
                  {z.fileCount} Dateien · {z.variant}
                </div>
                {z.error && (
                  <div className="text-semantic-danger text-ui-xs mt-0.5 break-all">
                    {z.error}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <When at={z.at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function WebhookSection({
  rows,
  busyId,
  onRetry,
}: {
  rows: JobWebhookRow[];
  busyId: string | null;
  onRetry: (id: string) => void;
}) {
  const t = useT();
  return (
    <Section title={t("super.jobsFailedWebhooksTitle")} count={rows.length}>
      <table className="w-full text-ui-sm">
        <tbody>
          {rows.map((w) => (
            <tr
              key={w.id}
              className="border-b border-line-subtle last:border-0 align-top"
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-ui-xs">{w.eventType}</span>
                  <span
                    className={
                      "px-2 py-0.5 rounded text-ui-xs font-medium " +
                      (w.status === "dead"
                        ? "bg-semantic-danger/10 text-semantic-danger"
                        : "bg-semantic-warning/10 text-semantic-warning")
                    }
                  >
                    {w.status === "dead" ? "aufgegeben" : "fehlgeschlagen"}
                  </span>
                  <span className="text-ink-tertiary text-ui-xs">
                    {w.attempts} Versuche
                    {w.httpStatus != null ? ` · HTTP ${w.httpStatus}` : ""}
                  </span>
                </div>
                <div className="text-ink-tertiary text-ui-xs mt-0.5 break-all">
                  {w.tenant} · {w.url}
                </div>
                {w.error && (
                  <div className="text-semantic-danger text-ui-xs mt-0.5 break-all">
                    {w.error}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                <When at={w.at} />
              </td>
              <td className="px-3 py-2 text-right">
                <RetryButton
                  busy={busyId === w.id}
                  onClick={() => onRetry(w.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
