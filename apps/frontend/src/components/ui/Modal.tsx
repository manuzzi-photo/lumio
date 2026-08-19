"use client";

/**
 * Gemeinsame Modal-Basis.
 *
 * Vorher gab es zwei lokale Kopien (studio/team, print-shop/products) und an
 * 37 Stellen die eingebauten Browser-Dialoge window.confirm/alert/prompt.
 * Letztere werden in manchen Browsern — unter anderem Brave auf iOS —
 * stillschweigend unterdrueckt: der Dialog erscheint nie, confirm() liefert
 * false, und der Knopf wirkt schlicht kaputt. Kein Fehler, keine Meldung,
 * keine Aktion.
 *
 * Diese Komponente ist die Grundlage fuer useConfirm() und usePrompt() und
 * kann die beiden lokalen Kopien ersetzen.
 */
import { useEffect, useRef } from "react";

export function Modal({
  onClose,
  children,
  labelledBy,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** id der Ueberschrift im Dialog, fuer Screenreader. */
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape schliesst — bei den Browser-Dialogen war das selbstverstaendlich
  // und ginge beim Nachbau sonst verloren.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fokus in den Dialog holen, damit Tastatur- und Screenreader-Bedienung
  // nicht hinter dem Overlay weiterlaeuft.
  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
  }, []);

  // Scrollen der Seite hinter dem Overlay unterbinden.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        ref={panelRef}
        className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-5">{children}</div>;
}
