import { normalizeInvoice } from './normalize.mjs';
export function invoiceTotal(raw) {
  const invoice = normalizeInvoice(raw);
  return invoice.items.reduce((sum, item) => sum + item.price * item.count, 0);
}
