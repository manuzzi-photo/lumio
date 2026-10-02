import { describe, it, expect, vi, beforeEach } from "vitest";

const retrieve = vi.fn();
const cancel = vi.fn();
const findOrder = vi.fn();
const findConnect = vi.fn();

vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { retrieve, cancel };
  },
}));
vi.mock("../../db.js", () => ({
  prisma: {
    printOrder: { findUnique: findOrder },
    tenantStripeConnect: { findUnique: findConnect },
  },
}));
vi.mock("../../config.js", () => ({
  config: { STRIPE_SECRET_KEY: "sk_test_x" },
}));

const load = () => import("./payment.js");

describe("cancelPaymentIntentForOrder", () => {
  beforeEach(() => {
    vi.resetModules();
    retrieve.mockReset();
    cancel.mockReset();
    findOrder.mockReset();
    findConnect.mockReset();
    findOrder.mockResolvedValue({
      id: "o1",
      tenantId: "t1",
      stripePaymentIntentId: "pi_1",
    });
    findConnect.mockResolvedValue({ stripeConnectedAccountId: "acct_1" });
  });

  it("does nothing when the order has no PaymentIntent", async () => {
    findOrder.mockResolvedValue({ id: "o1", tenantId: "t1", stripePaymentIntentId: null });
    const { cancelPaymentIntentForOrder } = await load();
    await cancelPaymentIntentForOrder("o1");
    expect(retrieve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels an open PaymentIntent on the connected account", async () => {
    retrieve.mockResolvedValue({ id: "pi_1", status: "requires_payment_method" });
    const { cancelPaymentIntentForOrder } = await load();
    await cancelPaymentIntentForOrder("o1");
    expect(retrieve).toHaveBeenCalledWith("pi_1", { stripeAccount: "acct_1" });
    expect(cancel).toHaveBeenCalledWith("pi_1", undefined, {
      stripeAccount: "acct_1",
    });
  });

  it("leaves an already cancelled PaymentIntent alone", async () => {
    retrieve.mockResolvedValue({ id: "pi_1", status: "canceled" });
    const { cancelPaymentIntentForOrder } = await load();
    await cancelPaymentIntentForOrder("o1");
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "processing"])(
    "refuses when the payment is %s, so the order is not switched",
    async (status) => {
      retrieve.mockResolvedValue({ id: "pi_1", status });
      const { cancelPaymentIntentForOrder } = await load();
      await expect(cancelPaymentIntentForOrder("o1")).rejects.toThrow(
        /bezahlt/
      );
      expect(cancel).not.toHaveBeenCalled();
    }
  );

  it("fails when the Stripe account is missing", async () => {
    findConnect.mockResolvedValue(null);
    const { cancelPaymentIntentForOrder } = await load();
    await expect(cancelPaymentIntentForOrder("o1")).rejects.toThrow(
      /Stripe-Connect-Account/
    );
    expect(retrieve).not.toHaveBeenCalled();
  });
});
