/**
 * Lumio API — which download versions a gallery offers (#70)
 *
 * A gallery offers downloads at all (downloadEnabled) and, within that, the
 * original files (downloadOriginalsEnabled) and/or the web version
 * (downloadWebEnabled: web_jpeg/web for images, the MP4 for videos). Every
 * customer download path (single file, ZIP of everything, selection, picks,
 * tag filter, ZIP polling) asks the same question here, so they cannot drift.
 */

export type CustomerDownloadVariant = "original" | "web";

export interface DownloadFlags {
  downloadOriginalsEnabled: boolean;
  downloadWebEnabled: boolean;
}

/** ?variant=web selects the web version; anything else (or nothing, for old
 *  clients) means the original, as before. */
export function parseDownloadVariant(q: unknown): CustomerDownloadVariant {
  return q === "web" ? "web" : "original";
}

/** Error code if this gallery does not offer the requested version, else null.
 *  downloadEnabled itself is checked by the caller first. */
export function downloadVariantRefusal(
  gallery: DownloadFlags,
  variant: CustomerDownloadVariant
): "originals_disabled" | "web_disabled" | null {
  if (variant === "original" && !gallery.downloadOriginalsEnabled) {
    return "originals_disabled";
  }
  if (variant === "web" && !gallery.downloadWebEnabled) return "web_disabled";
  return null;
}

/**
 * The flags after a PATCH/create, or an error if that would leave downloads
 * switched on with nothing to download. Switching downloads off entirely is
 * downloadEnabled = false, not two false versions.
 */
export function resolveDownloadFlags(
  current: DownloadFlags & { downloadEnabled: boolean },
  patch: Partial<DownloadFlags & { downloadEnabled: boolean }>
): { ok: true; flags: DownloadFlags & { downloadEnabled: boolean } } | { ok: false } {
  const flags = {
    downloadEnabled: patch.downloadEnabled ?? current.downloadEnabled,
    downloadOriginalsEnabled:
      patch.downloadOriginalsEnabled ?? current.downloadOriginalsEnabled,
    downloadWebEnabled: patch.downloadWebEnabled ?? current.downloadWebEnabled,
  };
  if (flags.downloadEnabled && !flags.downloadOriginalsEnabled && !flags.downloadWebEnabled) {
    return { ok: false };
  }
  return { ok: true, flags };
}
