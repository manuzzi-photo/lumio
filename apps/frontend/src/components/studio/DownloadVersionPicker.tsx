"use client";

/**
 * Which version clients may download (#70): the web version, the originals,
 * or both. Used in a gallery's settings and in gallery templates.
 *
 * Three choices instead of two checkboxes, because "neither" is not a valid
 * state: switching downloads off entirely is the separate "Allow download"
 * setting. The API refuses the "neither" combination as well.
 */
import { useT } from "@/lib/i18n";

export type DownloadVersions = "web" | "originals" | "both";

export function versionsFromFlags(f: {
  downloadOriginalsEnabled: boolean;
  downloadWebEnabled: boolean;
}): DownloadVersions {
  if (f.downloadOriginalsEnabled && f.downloadWebEnabled) return "both";
  return f.downloadOriginalsEnabled ? "originals" : "web";
}

export function flagsFromVersions(v: DownloadVersions): {
  downloadOriginalsEnabled: boolean;
  downloadWebEnabled: boolean;
} {
  return {
    downloadOriginalsEnabled: v !== "web",
    downloadWebEnabled: v !== "originals",
  };
}

const OPTIONS: DownloadVersions[] = ["both", "originals", "web"];

export function DownloadVersionPicker({
  value,
  onChange,
  disabled,
}: {
  value: DownloadVersions;
  onChange: (next: DownloadVersions) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="py-1 space-y-2">
      <div className="text-ui text-ink-primary">{t("studio.downloadVersions")}</div>
      <div
        role="radiogroup"
        aria-label={t("studio.downloadVersions")}
        className="inline-flex flex-wrap rounded-md border border-line-strong overflow-hidden"
      >
        {OPTIONS.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => !active && onChange(opt)}
              className={`h-8 px-3 text-ui-sm transition-colors duration-motion border-r last:border-r-0 border-line-strong disabled:opacity-50 ${
                active
                  ? "bg-accent text-accent-contrast"
                  : "text-ink-secondary hover:bg-surface-sunken"
              }`}
            >
              {t(`studio.downloadVersions_${opt}` as const)}
            </button>
          );
        })}
      </div>
      <div className="text-ui-xs text-ink-tertiary leading-relaxed">
        {t(`studio.downloadVersions_${value}Desc` as const)}
      </div>
    </div>
  );
}
