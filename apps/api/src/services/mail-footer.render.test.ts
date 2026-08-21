import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAIL_LOCALES } from "./mail-i18n.js";

/**
 * Prueft die gerenderte Fusszeile, nicht nur die Helfer darunter. Der Fehler,
 * um den es geht, sass genau hier: der Satz war fest deutsch und behauptete
 * "gehostet in Deutschland", was auf einer selbst betriebenen Instanz nicht
 * stimmt.
 */
vi.mock("../config.js", () => ({
  config: {
    DEFAULT_MAIL_LOCALE: "de",
    MAIL_FOOTER_TEXT: undefined,
    MAIL_FOOTER_URL: undefined,
    PUBLIC_URL: "https://example.test",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  },
}));

const load = async () => (await import("./mail-layout.js")).renderMailLayout;

describe("mail footer rendering", () => {
  beforeEach(() => vi.resetModules());

  it("follows the recipient locale", async () => {
    const render = await load();
    expect(render({ bodyHtml: "<p>x</p>", locale: "de" })).toContain(
      "Verschickt von"
    );
    expect(render({ bodyHtml: "<p>x</p>", locale: "en" })).toContain("Sent via");
    expect(render({ bodyHtml: "<p>x</p>", locale: "it" })).toContain(
      "Inviato tramite"
    );
  });

  it("no longer claims German hosting", async () => {
    const render = await load();
    for (const locale of MAIL_LOCALES) {
      const html = render({ bodyHtml: "<p>x</p>", locale });
      expect(html).not.toContain("gehostet in Deutschland");
      expect(html).not.toContain("lumio-cloud.de");
    }
  });
});
