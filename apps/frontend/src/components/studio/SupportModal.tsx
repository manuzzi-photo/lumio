"use client";

/**
 * Support-Modal fuer das Studio.
 *
 * Bewusst schlanker als das Marketing-Formular: kein Name, kein Honeypot,
 * kein CAPTCHA. Der Nutzer ist eingeloggt, Tenant / Plan / Rolle / Version
 * haengt die API automatisch an — er soll nur schreiben muessen, was er
 * braucht.
 *
 * Die Rueckrufadresse ist vorbelegt mit der Login-Mail und nur aufklappbar
 * editierbar, damit der Normalfall ein Feld ist und nicht zwei.
 */
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function SupportModal({
  open,
  onClose,
  userEmail,
}: {
  open: boolean;
  onClose: () => void;
  userEmail: string | null;
}) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Beim Oeffnen zuruecksetzen, damit ein zweites Anliegen nicht auf dem
  // alten Text aufsetzt.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSent(false);
    setSending(false);
    const id = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tooShort = message.trim().length < 10;

  async function submit() {
    if (tooShort || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.sendSupportRequest({
        message: message.trim(),
        replyEmail: showReply && replyEmail.trim() ? replyEmail.trim() : undefined,
        // Hilft beim Einordnen: aus welchem Teil des Studios kam die Frage?
        fromPath:
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : undefined,
      });
      setSent(true);
      setMessage("");
      setReplyEmail("");
      setShowReply(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // support_unavailable / send_failed heissen beide: die Nachricht ist
      // NICHT rausgegangen. Das muss der Nutzer erfahren, sonst wartet er
      // auf eine Antwort, die nie kommt.
      setError(
        msg.includes("support_unavailable") || msg.includes("send_failed")
          ? t("support.errUndelivered")
          : msg.includes("rate")
            ? t("support.errRate")
            : t("support.errGeneric")
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line-subtle bg-surface-raised shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-3.5">
          <h2
            id="support-modal-title"
            className="text-ui-lg font-medium text-ink-primary"
          >
            {t("support.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mr-1.5 rounded p-1.5 text-ink-tertiary transition-colors hover:bg-surface-canvas hover:text-ink-primary"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                d="M12 4 4 12M4 4l8 8"
              />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="px-5 py-8 text-center">
            <p className="text-ui font-medium text-ink-primary">
              {t("support.sentTitle")}
            </p>
            <p className="mt-1.5 text-ui-sm text-ink-secondary">
              {t("support.sentBody")}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-md border border-line-subtle px-4 py-2 text-ui-sm text-ink-primary transition-colors hover:bg-surface-canvas"
            >
              {t("common.close")}
            </button>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <p className="text-ui-sm leading-relaxed text-ink-secondary">
              {t("support.intro")}
            </p>

            <div>
              <label
                htmlFor="support-message"
                className="mb-1 block text-ui-sm font-medium text-ink-secondary"
              >
                {t("support.messageLabel")}
              </label>
              <textarea
                id="support-message"
                ref={textareaRef}
                rows={6}
                maxLength={5000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                placeholder={t("support.messagePlaceholder")}
                className="w-full resize-y rounded-md border border-line-subtle bg-surface-canvas px-3 py-2 text-ui text-ink-primary outline-none transition-colors focus:border-accent"
              />
            </div>

            <div className="text-ui-sm text-ink-tertiary">
              {showReply ? (
                <div>
                  <label
                    htmlFor="support-reply"
                    className="mb-1 block font-medium text-ink-secondary"
                  >
                    {t("support.replyLabel")}
                  </label>
                  <input
                    id="support-reply"
                    type="email"
                    maxLength={200}
                    value={replyEmail}
                    onChange={(e) => setReplyEmail(e.target.value)}
                    placeholder={userEmail ?? ""}
                    className="w-full rounded-md border border-line-subtle bg-surface-canvas px-3 py-2 text-ui text-ink-primary outline-none transition-colors focus:border-accent"
                  />
                </div>
              ) : (
                <p>
                  {userEmail
                    ? t("support.replyTo").replace("{email}", userEmail)
                    : t("support.replyToUnknown")}{" "}
                  <button
                    type="button"
                    onClick={() => setShowReply(true)}
                    className="underline transition-colors hover:text-ink-primary"
                  >
                    {t("support.replyChange")}
                  </button>
                </p>
              )}
            </div>

            {error && (
              <p className="text-ui-sm text-red-500" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-2 text-ui-sm text-ink-tertiary transition-colors hover:text-ink-primary"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={tooShort || sending}
                className="rounded-md bg-accent px-4 py-2 text-ui-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? t("support.sending") : t("support.submit")}
              </button>
            </div>

            <p className="text-ui-xs leading-relaxed text-ink-tertiary">
              {t("support.contextNote")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
