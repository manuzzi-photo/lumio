import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Rangfolge der Fusszeile: Super-Admin-Eintrag > Umgebungsvariable >
 * uebersetzter Standard.
 *
 * Wichtig, weil die mittlere Stufe bestehende Deployments schuetzt: wer
 * MAIL_FOOTER_TEXT gesetzt hat, soll seine Einstellung nicht dadurch
 * verlieren, dass es die Oberflaeche jetzt auch gibt.
 */
vi.mock("../config.js", () => ({
  config: {
    DEFAULT_MAIL_LOCALE: "de",
    MAIL_FOOTER_TEXT: "Aus der Umgebung",
    MAIL_FOOTER_URL: undefined,
    PUBLIC_URL: "https://example.test",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  },
}));

const setting = vi.fn<(key: string) => string | undefined>();
vi.mock("./instance-settings.js", () => ({
  instanceSetting: (k: string) => setting(k),
  KEY_MAIL_FOOTER_TEXT: "mail_footer_text",
  KEY_MAIL_FOOTER_URL: "mail_footer_url",
}));

const render = async () =>
  (await import("./mail-layout.js")).renderMailLayout;

describe("mail footer precedence", () => {
  beforeEach(() => {
    vi.resetModules();
    setting.mockReset();
  });

  it("prefers the super admin setting over the environment", async () => {
    setting.mockImplementation((k) =>
      k === "mail_footer_text" ? "Aus der Oberfläche" : undefined
    );
    const html = (await render())({ bodyHtml: "<p>x</p>", locale: "de" });
    expect(html).toContain("Aus der Oberfläche");
    expect(html).not.toContain("Aus der Umgebung");
  });

  it("falls back to the environment when nothing is stored", async () => {
    setting.mockReturnValue(undefined);
    const html = (await render())({ bodyHtml: "<p>x</p>", locale: "de" });
    expect(html).toContain("Aus der Umgebung");
  });

  it("lets an operator drop the Lumio mention entirely", async () => {
    setting.mockImplementation((k) =>
      k === "mail_footer_text" ? "Verschickt von Müller Fotografie" : undefined
    );
    const html = (await render())({ bodyHtml: "<p>x</p>", locale: "de" });
    expect(html).toContain("Müller Fotografie");
    expect(html).not.toContain(">Lumio</a>");
  });
});
