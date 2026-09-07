/**
 * Client-side mirror of the server's quantity-break price resolution
 * (apps/api/src/services/print/pricing-tiers.ts, resolveUnitPriceForQuantity).
 * Used only for live previews (product picker, cart) — the checkout
 * total is always recomputed and enforced server-side via priceCart(),
 * so drift here can only affect what a customer sees before paying,
 * never what they're actually charged.
 */

export interface PrintPriceTierLike {
  minQty: number;
  maxQty: number | null;
  unitPriceCents: number;
}

export function unitPriceForQuantity(
  variant: { priceCents: number; priceTiers?: PrintPriceTierLike[] },
  quantity: number
): number {
  const tiers = variant.priceTiers;
  if (!tiers || tiers.length === 0) return variant.priceCents;

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const match = sorted.find(
    (t) => quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty)
  );
  return match ? match.unitPriceCents : sorted[0].unitPriceCents;
}
