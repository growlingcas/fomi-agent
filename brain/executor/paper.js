// Бумажная торговля: реальные цены, виртуальные доллары. Учитывает комиссию fomo и проскальзывание.
import { CFG } from "../config.js";
import { priceOf } from "../bank.js";

const slip = (size, t) => Math.max(0.003, Math.min(0.15, (size / Math.max(1, t.liqUsd)) * 2));

export async function buy(bank, t, size, meta) {
  const price = priceOf(t) * (1 + slip(size, t));
  const tokens = (size * (1 - CFG.bank.feePct)) / price;
  bank.cash -= size;
  const pos = { id: "p" + Date.now().toString(36), address: t.address, symbol: t.symbol, url: t.url,
    entryPrice: price, entryMcap: t.mcap || t.fdv || 0, lastPrice: priceOf(t), size, tokens, remaining: 1, peak: price,
    tp1Done: false, openedAt: Date.now(), ...meta };
  bank.positions.push(pos);
  return { filled: true, pos };
}

export async function sell(bank, pos, pct, t) {
  const portion = pos.remaining * pct;
  const price = priceOf(t) * (1 - slip(pos.size * portion, t));
  const proceeds = pos.tokens * portion * price * (1 - CFG.bank.feePct);
  const cost = pos.size * portion;
  bank.cash += proceeds;
  pos.remaining -= portion;
  pos.realized = (pos.realized || 0) + (proceeds - cost);
  return { filled: true, proceeds, pnl: proceeds - cost };
}
