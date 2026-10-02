// Сигналы — то, что «приходит ей в голову». Каждый от 0 до 1.
// Итоговый скор = взвешенная сумма. Веса учатся на её собственных сделках (см. learn.js).
import { CFG } from "./config.js";

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lin = (x, x0, x1) => clamp((x - x0) / (x1 - x0));

export const SIGNALS = ["momentum", "volume", "buyers", "liquidity", "freshness", "social", "smart", "safety"];

export function passesFilters(t) {
  const f = CFG.filters;
  if (t.liqUsd < f.minLiqUsd) return "low liquidity";
  if (t.ageMin > f.maxAgeH * 60) return "too old";
  if (t.ageMin < f.minAgeMin) return "too new";
  if (t.vol.h1 < f.minVol1hUsd) return "dead volume";
  if (!t.priceNative) return "no price";
  if (t.gmgn?.wash) return "wash trading";
  if (t.gmgn?.rug != null && t.gmgn.rug > 0.3) return "rug risk";
  return null;
}

export function computeSignals(t, ctx = {}) {
  const b5 = t.txns.m5.b, s5 = t.txns.m5.s, b1 = t.txns.h1.b, s1 = t.txns.h1.s;
  const buyRatio = (b5 + b1 * 0.3) / Math.max(1, b5 + s5 + (b1 + s1) * 0.3);
  const mentions = ctx.x?.count ?? null;
  const fomoCount = ctx.fomo?.count ?? null;

  const momentum = clamp(lin(t.chg.h1, -10, 80) * 0.7 + lin(t.chg.m5, -5, 15) * 0.3);
  const volume = lin(t.vol.h1 / Math.max(1, t.liqUsd), 0.1, 3);
  const buyers = lin(buyRatio, 0.42, 0.7);
  const liquidity = lin(Math.log10(Math.max(1, t.liqUsd)), 4.1, 5.4);
  const freshness = t.ageMin < 360 ? 1 : clamp(1 - (t.ageMin - 360) / (CFG.filters.maxAgeH * 60 - 360));
  const social = clamp(
    (t.socials.twitter ? 0.3 : 0) + (t.socials.telegram ? 0.15 : 0) + (t.socials.website ? 0.15 : 0) +
    (t.boosted ? 0.1 : 0) + (mentions != null ? lin(mentions, 2, 30) * 0.2 : 0.1) + (fomoCount != null ? lin(fomoCount, 1, 10) * 0.1 : 0.05)
  );
  const fdvLiq = t.fdv / Math.max(1, t.liqUsd);
  let risk = clamp(lin(fdvLiq, 8, 40) * 0.4 + lin(t.chg.h1, 150, 500) * 0.35 + lin(0.5 - buyRatio, 0, 0.2) * 0.25);
  const g = t.gmgn;
  if (g) {   // данные GMGN: концентрация холдеров, rug, бандлеры, дев ещё держит, mint/freeze
    const gRisk = clamp((g.rug ?? 0.15) * 1.6 * 0.3 + lin(g.top10 ?? 0.3, 0.2, 0.6) * 0.3 + lin(g.bundler ?? 0, 0.1, 0.4) * 0.15 +
      (g.devHolds ? 0.1 : 0) + (g.mintRenounced && g.freezeRenounced ? 0 : 0.15));
    risk = clamp(risk * 0.5 + gRisk * 0.5);
  }
  const safety = 1 - risk;
  const smart = g ? lin(g.smart + g.kol * 0.5, 0, 6) : 0.35;   // smart money и KOL в токене

  return { momentum, volume, buyers, liquidity, freshness, social, smart, safety };
}

export function score(sig, weights) {
  let s = 0, w = 0;
  for (const k of SIGNALS) { s += (weights[k] ?? 1) * sig[k]; w += weights[k] ?? 1; }
  return Math.round((100 * s) / w);
}
