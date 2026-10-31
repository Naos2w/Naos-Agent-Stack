import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvoice } from './src/normalize.mjs';
import { invoiceTotal } from './src/total.mjs';
test('normalized public contract is retained', () => {
  assert.deepEqual(normalizeInvoice({ items: [{ price_cents: 125, qty: 2 }] }), {
    lineItems: [{ unitCents: 125, quantity: 2 }], discountCents: 0,
  });
});
test('total uses integer cents, quantities and discount without mutating input', () => {
  const raw = { items: [{ price_cents: 125, qty: 2 }, { price_cents: 40, qty: 3 }], discount_cents: 20 };
  const before = structuredClone(raw);
  assert.equal(invoiceTotal(raw), 350);
  assert.deepEqual(raw, before);
});
test('empty and over-discounted invoices cannot have negative totals', () => {
  assert.equal(invoiceTotal({ items: [] }), 0);
  assert.equal(invoiceTotal({ items: [{ price_cents: 50, qty: 1 }], discount_cents: 100 }), 0);
});
