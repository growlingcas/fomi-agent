// Торговля через приложение fomo на облачном телефоне (VMOS / эмулятор / реальный Android).
// Учёт позиции ведём по котировке DexScreener в момент сделки (приложение не отдаёт точную цену заливки).
import { CFG } from "../config.js";
import * as app from "../phone/fomo-app.js";
import * as paper from "./paper.js";

export async function buy(bank, t, sizeSol, meta) {
  const r = await app.buy({ address: t.address, symbol: t.symbol, sizeSol });
  if (r.dry) return { filled: false, dry: true };
  if (!r.filled) return { filled: false };
  const res = await paper.buy(bank, t, sizeSol, { ...meta, via: "phone" });
  if (meta.thesis) await app.postThesis(t.symbol, meta.thesis);
  return res;
}

export async function sell(bank, pos, pct, t, reason) {
  const r = await app.sell({ address: pos.address, symbol: pos.symbol, pct });
  if (!r.filled) return { filled: false, dry: r.dry };
  return paper.sell(bank, pos, pct, t);
}
