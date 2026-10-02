import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAIL_LOCALES } from "./mail-i18n.js";

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

const order = (paymentMode: string) => ({
  id: "o1",
  orderNumber: "P-1001",
  totalCents: 4500,
  currency: "EUR",
  paymentMode,
  guestEmail: "anna@example.test",
  guestName: "Anna Rossi",
  shippingAddress: null,
  guestNote: null,
  trackingNumber: null,
  trackingCarrier: null,
  trackingUrl: null,
  items: [
    {
      quantity: 1,
      unitPriceCents: 3000,
      totalPriceCents: 3000,
      printProductVariant: { name: "Fine Art", widthMm: 200, heightMm: 300 },
      file: { id: "f1", filename: "a.jpg" },
    },
  ],
  shippingMethod: null,
  subtotalCents: 3000,
  shippingCents: 1500,
  taxCents: 0,
});

const load = () => import("./mail-print.js");

describe("print order mails", () => {
  beforeEach(() => vi.resetModules());

  it("order-received mail does not claim the payment arrived", async () => {
    const { tmplPrintOrderConfirmGuest } = await load();
    const m = tmplPrintOrderConfirmGuest({
      studioName: "Studio X",
      supportEmail: "hi@studio.test",
      order: order("stripe_connect"),
      locale: "it",
    });
    expect(m.text).toContain("P-1001");
    expect(m.text).toContain("Non appena il tuo pagamento è arrivato");
    expect(m.text).not.toContain("Stiamo preparando il tuo ordine");
  });

  it("order-received mail for an offline invoice mentions the invoice", async () => {
    const { tmplPrintOrderConfirmGuest } = await load();
    const m = tmplPrintOrderConfirmGuest({
      studioName: "Studio X",
      supportEmail: "",
      order: order("offline_invoice"),
      locale: "en",
    });
    expect(m.text).toContain("will send you an invoice");
  });

  it("paid mail confirms the payment and the production start", async () => {
    const { tmplPrintOrderPaidGuest } = await load();
    const m = tmplPrintOrderPaidGuest({
      studioName: "Studio X",
      supportEmail: "",
      order: order("stripe_connect"),
      locale: "en",
    });
    expect(m.subject).toBe("Payment received for your order P-1001");
    expect(m.text).toContain("we have received your payment");
    expect(m.html).toContain("P-1001");
  });

  it("paid-on-delivery mail does not say the order goes into production", async () => {
    const { tmplPrintOrderPaidGuest } = await load();
    const m = tmplPrintOrderPaidGuest({
      studioName: "Studio X",
      supportEmail: "",
      order: order("cash_on_delivery"),
      locale: "en",
    });
    expect(m.text).toContain("we have received your payment");
    expect(m.text).not.toContain("production");
    expect(m.html).not.toContain("production");
  });

  it("paid mail exists in every locale", async () => {
    const { tmplPrintOrderPaidGuest } = await load();
    for (const locale of MAIL_LOCALES) {
      const m = tmplPrintOrderPaidGuest({
        studioName: "Studio X",
        supportEmail: "",
        order: order("stripe_connect"),
        locale,
      });
      expect(m.subject).toContain("P-1001");
      expect(m.subject).not.toContain("{");
    }
  });

  it("studio mail flags the payment as still pending", async () => {
    const { tmplPrintOrderNotifyStudio } = await load();
    const m = tmplPrintOrderNotifyStudio({
      studioName: "Studio X",
      order: order("stripe_connect"),
      baseUrl: "https://example.test",
      locale: "de",
    });
    expect(m.text).toContain("Zahlung ausstehend");
    expect(m.text).toContain("/studio/print-shop/orders/o1");
  });
});
