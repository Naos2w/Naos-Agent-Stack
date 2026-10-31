export function normalizeInvoice(raw) {
  return {
    lineItems: raw.items.map(item => ({ unitCents: item.price_cents, quantity: item.qty })),
    discountCents: raw.discount_cents ?? 0,
  };
}
