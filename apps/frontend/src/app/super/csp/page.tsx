"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CspViolationRow } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { useT } from "@/lib/i18n";

export default function SuperCspPage() {
  return (
    <SuperShell>
      <CspView />
    </SuperShell>
  );
}

function CspView() {
  const t = useT();
  const [rows, setRows] = useState<CspViolationRow[]>([]);
  const [distinct, setDistinct] = useState(0);
  const [totalEvents, setTotalEvents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superListCspViolations();
      setRows(r.violations);
      setDistinct(r.distinct);
      setTotalEvents(r.totalEvents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearAll() {
    if (
      !window.confirm(
        t("super.cspClearConfirm")
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await api.superClearCsp();
      await load();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">{t("super.cspTitle")}</h1>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={clearing}
            className="h-9 px-4 rounded border border-line-subtle text-ui-sm hover:bg-surface-sunken disabled:opacity-50"
          >
            {clearing ? t("super.cspClearing") : t("super.cspClear")}
          </button>
        )}
      </div>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        {t("super.cspSubtitleBefore")}
        <strong>{t("super.cspReportOnly")}</strong>
        {t("super.cspSubtitleAfter")}
      </p>

      {!loading && rows.length > 0 && (
        <div className="text-ui-sm text-ink-tertiary mb-3">
          {distinct} verschiedene Verstöße · {totalEvents} Meldungen gesamt
        </div>
      )}

      {loading ? (
        <div className="text-ui text-ink-tertiary">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
          <p className="text-ui text-ink-tertiary">
            {t("super.cspEmpty")}
          </p>
          <p className="text-ui-sm text-ink-tertiary mt-2 max-w-md mx-auto">
            {t("super.cspEmptyHint")}
          </p>
        </div>
      ) : (
        <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
          <table className="w-full text-ui-sm">
            <thead className="text-ink-tertiary text-ui-xs uppercase tracking-wide">
              <tr className="border-b border-line-subtle">
                <th className="text-left font-medium px-3 py-2">{t("super.cspColDirective")}</th>
                <th className="text-left font-medium px-3 py-2">
                  {t("super.cspColBlockedSource")}
                </th>
                <th className="text-right font-medium px-3 py-2">{t("super.cspColCount")}</th>
                <th className="text-left font-medium px-3 py-2">
                  {t("super.cspColLast")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-line-subtle last:border-0 align-top"
                >
                  <td className="px-3 py-2 font-mono text-ui-xs whitespace-nowrap">
                    {v.effectiveDirective}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-ui-xs break-all">
                      {v.blockedUri}
                    </span>
                    {v.sampleDocumentUri && (
                      <div className="text-ink-tertiary text-ui-xs break-all mt-0.5">
                        auf {v.sampleDocumentUri}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {v.count}
                  </td>
                  <td className="px-3 py-2 text-ink-tertiary text-ui-xs whitespace-nowrap">
                    {new Date(v.lastSeenAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
