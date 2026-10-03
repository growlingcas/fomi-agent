// Торговля через приложение fomo на облачном телефоне VMOS.
// Учёт позиции — по цене DexScreener в момент сделки (приложение не отдаёт точную цену заливки).
import * as app from "../phone/fomo-app.js";
import * as paper from "./paper.js";

export async function buy(bank, t, size, meta) {
  const r = await app.buy({ address: t.address, symbol: t.symbol, usd: size, thesis: meta.thesis });
  if (r.dry) return { filled: false, dry: true };
  if (!r.filled) return { filled: false };
  return paper.buy(bank, t, size, { ...meta, via: "phone", thesisPosted: !!r.thesisPosted });
}

export async function sell(bank, pos, pct, t, reason) {
  const r = await app.sell({ address: pos.address, symbol: pos.symbol, pct });
  if (!r.filled) return { filled: false, dry: r.dry, stuck: r.stuck };
  return paper.sell(bank, pos, pct, t);
}
