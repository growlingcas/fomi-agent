// Ручной режим: мозг кладёт ордер в очередь, ты покупаешь/продаёшь сам в fomo
// и подтверждаешь: `npm run confirm -- <orderId> [ценаВSOL]`.
export async function buy(bank, t, sizeSol, meta) {
  const order = { id: "o" + Date.now().toString(36), side: "buy", address: t.address, symbol: t.symbol, url: t.url,
    sizeSol, refPrice: t.priceNative, createdAt: Date.now(), meta };
  bank.orders.push(order);
  return { filled: false, order };
}
export async function sell(bank, pos, pct, t, reason) {
  if (bank.orders.some((o) => o.side === "sell" && o.posId === pos.id)) return { filled: false };
  const order = { id: "o" + Date.now().toString(36), side: "sell", posId: pos.id, symbol: pos.symbol, pct,
    refPrice: t.priceNative, reason, createdAt: Date.now() };
  bank.orders.push(order);
  return { filled: false, order };
}
