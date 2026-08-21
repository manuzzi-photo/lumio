"use client";

/**
 * Uebersetzung von Katalog-Texten, die die API mitliefert.
 *
 * Einige Anzeigetexte entstehen nicht im Frontend, sondern kommen fertig aus
 * der API: die Beschreibungen der Tarife (services/plans.ts), die
 * Feature-Flags (services/feature-flags.ts), die Print-Provider und ihre
 * Konfigurationsfelder (services/print/providers.ts) sowie die
 * Benachrichtigungs-Schalter (services/notifications.ts).
 *
 * Die sind dort auf Deutsch hinterlegt. Wer die Oberflaeche auf Englisch
 * oder Italienisch stellt, sah sie trotzdem deutsch — und keine der
 * i18n-Pruefungen konnte das melden, weil im Frontend gar kein t()-Aufruf
 * steht, der ins Leere zeigen koennte.
 *
 * Konvention: aus dem stabilen Key der API wird ein Dictionary-Key,
 * "print_shop" -> "settings.catalogFlagPrintShopDesc". Fehlt der Eintrag,
 * gewinnt der Text aus der API. Das ist Absicht: kennt eine neuere API
 * einen Eintrag, den dieses Frontend noch nicht hat, steht dort deutscher
 * Text — unschoen, aber deutlich besser als ein roher Key-Name im UI.
 */
import { useT } from "@/lib/i18n";

/** "print_shop" -> "PrintShop" */
function pascal(key: string): string {
  return key
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export type CatalogKind =
  | "Plan"
  | "Flag"
  | "Provider"
  | "NotifEvent"
  | "Funnel";

/**
 * Baut den Dictionary-Key. `suffix` unterscheidet mehrere Texte am selben
 * Eintrag (Label vs. Beschreibung).
 */
export function catalogKey(
  kind: CatalogKind,
  apiKey: string,
  suffix: string
): string {
  const prefix = kind === "NotifEvent" ? "notifEvent" : `catalog${kind}`;
  return `settings.${prefix}${pascal(apiKey)}${suffix}`;
}

export interface CatalogTranslator {
  /**
   * Uebersetzt einen Katalog-Text. `fallback` ist der Wert aus der API und
   * wird genau dann verwendet, wenn es keinen Dictionary-Eintrag gibt.
   */
  (
    kind: CatalogKind,
    apiKey: string,
    suffix: string,
    fallback: string
  ): string;
}

export function useCatalogText(): CatalogTranslator {
  const t = useT();
  return (kind, apiKey, suffix, fallback) => {
    const key = catalogKey(kind, apiKey, suffix);
    const value = t(key);
    // t() liefert bei fehlendem Key den Key selbst zurueck — deshalb hier
    // vergleichen statt auf Truthiness zu pruefen.
    return value === key ? fallback : value;
  };
}
