import { describe, it, expect, vi } from "vitest";

/**
 * Der Test, der vor diesem Merge fehlschlug.
 *
 * Die Templates loesten die Empfaengersprache korrekt auf und uebersetzten
 * ihren Inhalt — aber KEINE der 35 renderMailLayout()-Aufrufstellen reichte
 * das Locale weiter. Fusszeile und lang-Attribut fielen deshalb immer auf
 * die Instanz-Vorgabe zurueck: englischer Text in einem deutschen Rahmen.
 *
 * Gefunden von manuzzi in PR #15, nachdem der sichtbare Teil (die deutsche
 * Fusszeile) bereits behoben schien. Das Symptom war behoben, die Ursache
 * nicht.
 */
vi.mock("../config.js", () => ({
  config: {
    DEFAULT_MAIL_LOCALE: "de",
    MAIL_FOOTER_TEXT: undefined,
    MAIL_FOOTER_URL: undefined,
    PUBLIC_URL: "https://example.test",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    SUPPORT_EMAIL: null,
  },
}));
vi.mock("./instance-settings.js", () => ({
  instanceSetting: () => undefined,
  KEY_MAIL_FOOTER_TEXT: "mail_footer_text",
  KEY_MAIL_FOOTER_URL: "mail_footer_url",
}));

describe("an English mail on a German-default instance", () => {
  it("is English all the way through, frame included", async () => {
    const { tmplWelcome } = await import("./mail.js");
    const out = tmplWelcome({
      locale: "en",
      displayName: "Sam",
      studioName: "Sam Studio",
      studioUrl: "https://example.test",
      trialEndsAt: new Date(Date.UTC(2026, 8, 1)),
      planName: "Solo",
    });
    expect(out.subject).toContain("Welcome");
    expect(out.html).toContain("Sent via");
    expect(out.html).toContain('lang="en"');
    expect(out.html).not.toContain("Verschickt von");
  });

  it("still renders German when that is the recipient's language", async () => {
    const { tmplWelcome } = await import("./mail.js");
    const out = tmplWelcome({
      locale: "de",
      displayName: "Sam",
      studioName: "Sam Studio",
      studioUrl: "https://example.test",
      trialEndsAt: new Date(Date.UTC(2026, 8, 1)),
      planName: "Solo",
    });
    expect(out.html).toContain("Verschickt von");
    expect(out.html).toContain('lang="de"');
  });
});
