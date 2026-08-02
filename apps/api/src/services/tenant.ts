/**
 * Tenant-bezogene Helper.
 *
 * Trennt internen Verwaltungsnamen (Tenant.name) vom oeffentlichen
 * Anzeigenamen (Tenant.displayName). Wer einen Tenant in einer
 * oeffentlich sichtbaren Kontext (Login-Header, Mail, Welcome-Flow)
 * referenziert, sollte tenantDisplayName(tenant) statt tenant.name
 * direkt verwenden.
 *
 * Wenn displayName null oder leerer String, faellt der Helper auf
 * name zurueck — Tenants ohne gesetzten oeffentlichen Namen
 * verhalten sich exakt wie vorher.
 */

interface TenantWithNames {
  name: string;
  displayName: string | null;
}

/** Liefert den oeffentlichen Anzeigenamen mit Fallback auf den
 *  internen Verwaltungsnamen. */
export function tenantDisplayName(tenant: TenantWithNames): string {
  const dn = tenant.displayName?.trim();
  if (dn) return dn;
  return tenant.name;
}

/**
 * Welche Tenant-Status erlauben Login und Session-Validierung?
 *
 * - "active": Normalbetrieb
 * - "pending_deletion": Self-Service-Loeschung in Karenzphase. Owner
 *   soll noch einloggen koennen um die Loeschung zurueckzunehmen.
 *   Schreibzugriffe sind dabei ueber das read-only-Plugin gesperrt.
 *
 * Suspended/archived (Super-Admin-Aktion) sind hier explizit nicht
 * drin — das sind Compliance-Pfade die Login blockieren sollen.
 *
 * ACHTUNG: Das ist NICHT die richtige Pruefung fuer oeffentliche
 * Endkunden-Routen. Dafuer isTenantPubliclyVisible() benutzen.
 */
export function isTenantOperational(status: string | null | undefined): boolean {
  return status === "active" || status === "pending_deletion";
}

/**
 * Welche Tenant-Status erlauben oeffentlichen Endkunden-Zugriff auf
 * Galerien, Downloads, Proofing, Print-Shop und Upload-Links?
 *
 * Nur "active".
 *
 * Bewusst strenger als isTenantOperational(): sobald der Owner die
 * Loeschung seines Studios beantragt hat (status='pending_deletion'),
 * gehen alle oeffentlichen Inhalte SOFORT offline. Aufbewahren fuer
 * das 60-Tage-Undo-Fenster und Weiter-Veroeffentlichen sind zwei
 * verschiedene Dinge — nach einem Loeschantrag (DSGVO Art. 17) laesst
 * sich nur das Erste rechtfertigen.
 *
 * Die Daten bleiben in DB und S3 bis zum Hard-Delete erhalten; ein
 * cancelDeletion() setzt status zurueck auf 'active' und damit sind
 * die Galerien unveraendert wieder erreichbar.
 */
export function isTenantPubliclyVisible(
  status: string | null | undefined
): boolean {
  return status === "active";
}
