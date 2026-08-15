"use client";

/**
 * Super-Admin — Marketing-E-Mails
 *
 * Globaler Kill-Switch + Statistik über Opt-outs.
 * Per-Tenant-Override ist im Tenant-Detail-View eingebaut.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { useT } from "@/lib/i18n";
import { useErrorText } from "@/lib/error-i18n";

type Config = Awaited<ReturnType<typeof api.superGetMarketingConfig>>;

export default function SuperMarketingPage() {
  return (
    <SuperShell>
      <MarketingContent />
    </SuperShell>
  );
}

function MarketingContent() {
  const errText = useErrorText();
  const t = useT();
  const [data, setData] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.superGetMarketingConfig().then(setData);
  }, []);

  async function toggle() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api.superSetMarketingConfig(!data.globalEnabled);
      setData((d) => d ? { ...d, globalEnabled: r.globalEnabled } : d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(errText(err, t("common.error")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 sm:px-8 py-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">{t("super.mkTitle")}</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        {t("super.mkSubtitle")}
      </p>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>
      ) : (
        <div className="space-y-4">

          {/* Global Toggle */}
          <section className="rounded-lg border border-line-subtle bg-surface-raised p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-ink-primary">{t("super.mkKillSwitch")}</h2>
                <p className="text-ui-sm text-ink-tertiary mt-0.5">
                  {t("super.mkKillSwitchHint")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={data.globalEnabled}
                disabled={saving}
                onClick={() => void toggle()}
                className={
                  "relative inline-flex shrink-0 mt-0.5 h-6 w-11 items-center rounded-full px-0.5 transition-colors disabled:opacity-50 " +
                  (data.globalEnabled ? "bg-accent" : "bg-line-strong")
                }
              >
                <span
                  className={
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform " +
                    (data.globalEnabled ? "translate-x-5" : "translate-x-0")
                  }
                />
              </button>
            </div>
            {saved && (
              <p className="text-ui-xs text-semantic-success mt-2">
                {t("super.mkSaved")}
              </p>
            )}
            <div className="mt-3 inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-ui-sm font-medium border"
              style={{
                borderColor: data.globalEnabled ? "rgb(16 185 129 / 0.3)" : "rgb(239 68 68 / 0.3)",
                background: data.globalEnabled ? "rgb(16 185 129 / 0.08)" : "rgb(239 68 68 / 0.08)",
                color: data.globalEnabled ? "#059669" : "#dc2626",
              }}>
              {data.globalEnabled ? "✓ Aktiv" : "✕ Deaktiviert (global)"}
            </div>
          </section>

          {/* Stats */}
          <section className="rounded-lg border border-line-subtle bg-surface-raised p-5">
            <h2 className="font-semibold text-ink-primary mb-3">{t("super.mkOptOutStats")}</h2>
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label={t("super.mkTotalSubs")}
                value={data.stats.totalSubscriptions}
              />
              <StatCard
                label={t("super.mkMarketingEnabled")}
                value={data.stats.optedIn}
                highlight="green"
              />
              <StatCard
                label={t("super.mkOptedOut")}
                value={data.stats.optedOut}
                highlight={data.stats.optedOut > 0 ? "red" : undefined}
              />
            </div>
          </section>

          {/* Info */}
          <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 text-ui-sm text-ink-secondary space-y-2">
            <h2 className="font-semibold text-ink-primary mb-1">{t("super.mkWhatIsSent")}</h2>
            <div className="grid gap-2">
              {[
                {
                  when: t("super.mkWhen3DaysBeforeTrialEnd"),
                  what: t("super.mkWhat3DaysBeforeTrialEnd"),
                },
                {
                  when: t("super.mkWhenTrialCancelled"),
                  what: t("super.mkWhatTrialCancelled"),
                },
                {
                  when: t("super.mkWhenTrialExpired"),
                  what: t("super.mkWhatTrialExpired"),
                },
                {
                  when: t("super.mkWhenPaidCancelled"),
                  what: t("super.mkWhatPaidCancelled"),
                },
              ].map((row) => (
                <div key={row.when} className="flex gap-3">
                  <span className="shrink-0 font-medium text-ink-primary w-52">{row.when}</span>
                  <span>{row.what}</span>
                </div>
              ))}
            </div>
            <p className="pt-1 text-ink-tertiary">
              {t("super.mkFooterHint")}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "green" | "red";
}) {
  const color =
    highlight === "green"
      ? "text-semantic-success"
      : highlight === "red"
      ? "text-semantic-danger"
      : "text-ink-primary";
  return (
    <div className="rounded-md border border-line-subtle bg-surface-sunken p-3 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      <div className="text-ui-xs text-ink-tertiary mt-0.5">{label}</div>
    </div>
  );
}
