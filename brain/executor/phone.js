// Торговля через приложение fomo на облачном телефоне VMOS.
// Учёт позиции — по цене DexScreener в момент сделки (приложение не отдаёт точную цену заливки).
import * as app from "../phone/fomo-app.js";
import * as paper from "./paper.js";

export async function buy(bank, t, size, meta) {
  const r = await app.buy({ address: t.address, symbol: t.symbol, usd: size, thesis: meta.thesis });
  if (r.dry) return { filled: false, dry: true };
  if (!r.filled) return { filled: false, unconfirmed: r.unconfirmed };
  const res = await paper.buy(bank, t, size, { ...meta, via: "phone", thesisPosted: !!r.thesisPosted, thesisTries: 1 });
  return { ...res, thesisError: r.thesisPosted ? null : r.thesisError };
}

// Тезис не встал сразу — пробуем ещё раз отдельным заходом на страницу токена
export async function retryThesis(pos) {
  await app.openToken(pos.address, pos.symbol);
  return app.postThesis(pos.symbol, pos.thesis);
}

export async function sell(bank, pos, pct, t, reason) {
  const r = await app.sell({ address: pos.address, symbol: pos.symbol, pct });
  if (!r.filled) return { filled: false, dry: r.dry, stuck: r.stuck };
  return paper.sell(bank, pos, pct, t);
}
