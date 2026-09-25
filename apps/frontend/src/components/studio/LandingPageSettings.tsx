"use client";

/**
 * The settings of a landing page ("Page") in the studio editor: details
 * (title, intro, design), the page URL, and who can open it.
 *
 * Three independent sections, each with its own Save, like the gallery's
 * slug editor. A section only resets its own fields when the server value it
 * shows changes, so saving one section does not throw away unsaved edits in
 * another.
 */
import { useEffect, useState } from "react";
import {
  api,
  type BrandingDetail,
  type LandingPageAccess as Access,
  type StudioLandingPage,
} from "@/lib/api";
import { MarkdownField } from "@/components/studio/MarkdownField";
import { Button } from "@/components/ui";
import { useConfirm } from "@/components/ui/dialogs";
import { useErrorText } from "@/lib/error-i18n";
import { useT } from "@/lib/i18n";

const SECTION = "rounded-lg border border-line-subtle bg-surface-raised p-4 space-y-3";
const INPUT =
  "w-full rounded-md border border-line-subtle bg-surface-base px-3 py-2 text-sm disabled:opacity-50";
const WARNING =
  "rounded-md bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed";

function useOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

interface SectionProps {
  page: StudioLandingPage;
  /** Reload the page from the server after a save. */
  onSaved: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Details: title, introduction, design
// ---------------------------------------------------------------------------
export function LandingPageDetails({ page, onSaved }: SectionProps) {
  const t = useT();
  const errText = useErrorText();
  const [title, setTitle] = useState(page.title);
  const [intro, setIntro] = useState(page.introMarkdown ?? "");
  const [brandingId, setBrandingId] = useState(page.brandingId ?? "");
  const [brandings, setBrandings] = useState<BrandingDetail[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTitle(page.title), [page.title]);
  useEffect(() => setIntro(page.introMarkdown ?? ""), [page.introMarkdown]);
  useEffect(() => setBrandingId(page.brandingId ?? ""), [page.brandingId]);
  useEffect(() => {
    let alive = true;
    api
      .listBrandings()
      .then((r) => alive && setBrandings(r.brandings))
      .catch(() => {
        /* the selector just stays on "studio default" */
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty =
    title.trim() !== page.title ||
    intro !== (page.introMarkdown ?? "") ||
    brandingId !== (page.brandingId ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updatePage(page.id, {
        title: title.trim(),
        introMarkdown: intro.trim() ? intro : null,
        brandingId: brandingId || null,
      });
      await onSaved();
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={SECTION}>
      <h2 className="text-sm font-medium">{t("pages.detailsHeading")}</h2>

      <div className="space-y-1">
        <label className="text-xs font-medium text-ink-secondary" htmlFor="page-title">
          {t("pages.titleLabel")}
        </label>
        <input
          id="page-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className={INPUT}
        />
      </div>

      <MarkdownField
        label={t("pages.introLabel")}
        hint={t("pages.introHint")}
        value={intro}
        onChange={setIntro}
        rows={5}
        maxLength={5000}
      />

      <div className="space-y-1">
        <label className="text-xs font-medium text-ink-secondary" htmlFor="page-branding">
          {t("pages.brandingLabel")}
        </label>
        <select
          id="page-branding"
          value={brandingId}
          onChange={(e) => setBrandingId(e.target.value)}
          className={INPUT}
        >
          <option value="">{t("pages.brandingDefault")}</option>
          {brandings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <p className="text-ui-xs text-ink-tertiary leading-relaxed">
          {t("pages.brandingHint")}
        </p>
      </div>

      {error && <p className="text-sm text-semantic-danger">{error}</p>}
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={save}
          disabled={saving || !dirty || !title.trim()}
        >
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Address: the slug in /p/<slug>
// ---------------------------------------------------------------------------
export function LandingPageAddress({ page, onSaved }: SectionProps) {
  const t = useT();
  const errText = useErrorText();
  const origin = useOrigin();
  const [value, setValue] = useState(page.slug);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValue(page.slug), [page.slug]);

  const cleaned = value.trim().toLowerCase();
  const url = `${origin}/p/${page.slug}`;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updatePage(page.id, { slug: cleaned });
      await onSaved();
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(page.isStudioDefault ? `${origin}/` : url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context): the URL is visible to copy by hand */
    }
  }

  return (
    <section className={SECTION}>
      <div>
        <h2 className="text-sm font-medium">{t("pages.addressHeading")}</h2>
        <p className="text-xs text-ink-tertiary mt-0.5">{t("pages.addressDesc")}</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-ink-tertiary font-mono whitespace-nowrap">
            {origin}/p/
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s/g, ""))}
            maxLength={60}
            aria-label={t("pages.addressHeading")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 rounded-md border border-line-subtle bg-surface-base px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || !cleaned || cleaned === page.slug}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
          <Button onClick={copy}>
            {copied ? t("pages.linkCopied") : t("pages.copyLink")}
          </Button>
        </div>
      </div>

      {page.isStudioDefault && (
        <p className="text-xs text-ink-tertiary">
          {t("pages.addressStartPageNote", { origin: `${origin}/` })}
        </p>
      )}
      <div className={WARNING}>
        {t("pages.addressWarnPre")}{" "}
        <span className="font-mono">{url}</span> {t("pages.addressWarnPost")}
      </div>
      {error && <p className="text-sm text-semantic-danger">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Access: who can open the page, and whether it is the start page
// ---------------------------------------------------------------------------
const ACCESS_MODES: Access[] = ["public", "link_only", "password"];

export function LandingPageAccess({ page, onSaved }: SectionProps) {
  const t = useT();
  const errText = useErrorText();
  const confirm = useConfirm();
  const origin = useOrigin();
  const [access, setAccess] = useState<Access>(page.access);
  const [password, setPassword] = useState("");
  const [startPage, setStartPage] = useState(page.isStudioDefault);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAccess(page.access), [page.access]);
  useEffect(() => setStartPage(page.isStudioDefault), [page.isStudioDefault]);

  // Only a public page can be the start page: leaving public gives it up.
  const effectiveStartPage = access === "public" && startPage;
  const needsPassword = access === "password" && !page.hasPassword && !password;
  const dirty =
    access !== page.access ||
    effectiveStartPage !== page.isStudioDefault ||
    (access === "password" && password.length > 0);

  async function save() {
    setError(null);

    // Two changes that alter what the studio's front door shows deserve a
    // confirmation: taking "/" over, and giving it back.
    if (effectiveStartPage && !page.isStudioDefault) {
      const ok = await confirm({
        title: t("pages.confirmStartTitle"),
        message: t("pages.confirmStartMessage", { origin: `${origin}/` }),
        confirmLabel: t("pages.confirmStartAction"),
      });
      if (!ok) return;
    } else if (page.isStudioDefault && !effectiveStartPage) {
      const ok = await confirm({
        title: t("pages.confirmLeaveStartTitle"),
        message: t("pages.confirmLeaveStartMessage", { origin: `${origin}/` }),
        confirmLabel: t("pages.confirmLeaveStartAction"),
        destructive: true,
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      await api.updatePage(page.id, {
        access,
        ...(access === "password" && password ? { password } : {}),
        isStudioDefault: effectiveStartPage,
      });
      setPassword("");
      await onSaved();
    } catch (err) {
      setError(errText(err, t("pages.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={SECTION}>
      <h2 className="text-sm font-medium">{t("pages.accessHeading")}</h2>

      <div role="radiogroup" aria-label={t("pages.accessHeading")} className="space-y-2">
        {ACCESS_MODES.map((mode) => (
          <label
            key={mode}
            className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors duration-motion ${
              access === mode
                ? "border-accent bg-accent/5"
                : "border-line-subtle hover:border-line-strong"
            }`}
          >
            <input
              type="radio"
              name="page-access"
              value={mode}
              checked={access === mode}
              onChange={() => setAccess(mode)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">
                {t(`pages.access.${mode}`)}
              </span>
              <span className="block text-xs text-ink-tertiary leading-relaxed">
                {t(`pages.access.${mode}Desc`)}
              </span>
            </span>
          </label>
        ))}
      </div>

      {access === "password" && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-secondary" htmlFor="page-password">
            {t("pages.passwordLabel")}
          </label>
          <input
            id="page-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={200}
            placeholder={page.hasPassword ? t("pages.passwordKeep") : ""}
            className={INPUT}
          />
          {needsPassword && (
            <p className="text-xs text-semantic-warning">{t("pages.passwordNeeded")}</p>
          )}
        </div>
      )}

      <label
        className={`flex items-start gap-3 rounded-md border border-line-subtle px-3 py-2.5 ${
          access === "public" ? "cursor-pointer" : "opacity-60"
        }`}
      >
        <input
          type="checkbox"
          checked={effectiveStartPage}
          disabled={access !== "public"}
          onChange={(e) => setStartPage(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium">{t("pages.startPageLabel")}</span>
          <span className="block text-xs text-ink-tertiary leading-relaxed">
            {access === "public"
              ? t("pages.startPageDesc", { origin: `${origin}/` })
              : t("pages.startPageNeedsPublic")}
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-semantic-danger">{error}</p>}
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={save}
          disabled={saving || !dirty || needsPassword}
        >
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </section>
  );
}
