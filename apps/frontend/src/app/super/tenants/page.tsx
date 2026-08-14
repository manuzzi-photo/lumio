"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type SuperTenantSummary } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { SuperShell } from "@/components/super/SuperShell";
import { CreateTenantDialog } from "@/components/super/CreateTenantDialog";

export default function SuperTenantsPage() {
  return (
    <SuperShell>
      <TenantsList />
    </SuperShell>
  );
}

function TenantsList() {
  const t = useT();
  const [tenants, setTenants] = useState<SuperTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superListTenants();
      setTenants(r.tenants);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t("super.navTenants")}</h1>
          <p className="text-ui-sm text-ink-tertiary mt-0.5">
            {t("super.tenantsSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="h-9 px-4 rounded bg-accent text-accent-contrast font-medium text-ui-sm hover:bg-accent-hover transition-colors duration-motion"
        >
          {t("super.tenantsNew")}
        </button>
      </div>

      {loading ? (
        <div className="text-ui text-ink-tertiary">{t("common.loading")}</div>
      ) : tenants.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
          <p className="text-ui text-ink-tertiary">
            {t("super.tenantsEmpty")}
          </p>
        </div>
      ) : (
        <ul className="rounded-md border border-line-subtle bg-surface-raised divide-y divide-line-subtle overflow-hidden">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <Link
                href={`/super/tenants/${tenant.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-overlay transition-colors duration-motion"
              >
                <StatusDot status={tenant.status} readOnly={tenant.readOnly} />
                <div className="flex-1 min-w-0">
                  <div className="text-ui text-ink-primary truncate">
                    {tenant.name}
                    {tenant.displayName && tenant.displayName !== tenant.name && (
                      <span className="text-ui-xs text-ink-tertiary ml-2 font-normal">
                        {t("super.tenantsPublicAs", {
                          name: tenant.displayName,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="text-ui-xs text-ink-tertiary truncate font-mono">
                    {tenant.slug}
                    {tenant.customDomain && ` · ${tenant.customDomain}`}
                  </div>
                </div>
                <div className="text-ui-xs text-ink-tertiary text-right tabular-nums flex-shrink-0">
                  {t("super.tenantsCounts", {
                    users: tenant.userCount,
                    galleries: tenant.galleryCount,
                  })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateTenantDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StatusDot({
  status,
  readOnly = false,
}: {
  status: SuperTenantSummary["status"];
  readOnly?: boolean;
}) {
  const t = useT();
  const activeReadOnly = status === "active" && readOnly;
  const color = activeReadOnly
    ? "bg-semantic-warning"
    : status === "active"
    ? "bg-semantic-success"
    : status === "suspended"
    ? "bg-semantic-warning"
    : "bg-ink-tertiary";
  const title = activeReadOnly
    ? t("super.statusActiveReadOnly")
    : status === "active"
    ? t("super.statusActive")
    : status === "suspended"
    ? t("super.statusSuspended")
    : t("super.statusArchived");
  return (
    <span
      className={`block w-2 h-2 rounded-full flex-shrink-0 ${color}`}
      title={title}
      aria-label={title}
    />
  );
}
