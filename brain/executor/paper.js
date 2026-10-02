// Бумажная торговля: реальные цены, виртуальные деньги. Учитывает комиссию и проскальзывание.
import { CFG } from "../config.js";

const slip = (sizeSol, t) => {
  const solUsd = t.priceNative ? t.priceUsd / t.priceNative || 150 : 150;
  return Math.max(0.005, Math.min(0.15, ((sizeSol * solUsd) / Math.max(1, t.liqUsd)) * 2));
};

export async function buy(bank, t, sizeSol, meta) {
  const price = t.priceNative * (1 + slip(sizeSol, t));
  const tokens = (sizeSol * (1 - CFG.bank.feePct)) / price;
  bank.cash -= sizeSol;
  const pos = { id: "p" + Date.now().toString(36), address: t.address, symbol: t.symbol, url: t.url,
    entryPrice: price, lastPrice: t.priceNative, sizeSol, tokens, remaining: 1, peak: price, tp1Done: false,
    openedAt: Date.now(), ...meta };
  bank.positions.push(pos);
  return { filled: true, pos };
}

export async function sell(bank, pos, pct, t) {
  const portion = pos.remaining * pct;
  const price = t.priceNative * (1 - slip(pos.sizeSol * portion, t));
  const proceeds = pos.tokens * portion * price * (1 - CFG.bank.feePct);
  const cost = pos.sizeSol * portion;
  bank.cash += proceeds;
  pos.remaining -= portion;
  pos.realizedSol = (pos.realizedSol || 0) + (proceeds - cost);
  pos.proceeds = (pos.proceeds || 0) + proceeds;
  return { filled: true, proceeds, pnlSol: proceeds - cost };
}
