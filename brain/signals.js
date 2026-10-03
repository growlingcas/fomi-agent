// Сигналы — то, что «приходит ей в голову». Каждый от 0 до 1.
// Итоговый скор = взвешенная сумма. Веса учатся на её собственных сделках (см. learn.js).
import { CFG } from "./config.js";

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lin = (x, x0, x1) => clamp((x - x0) / (x1 - x0));

export const SIGNALS = ["momentum", "volume", "buyers", "liquidity", "freshness", "social", "smart", "safety"];

// pump.fun: по данным GMGN (launchpad) или по адресу — у токенов pump.fun он заканчивается на «pump»
const PUMP = new Set(["pump.fun", "pump_mayhem", "pump_agent", "pump_mayhem_agent"]);
export const isPumpFun = (t) => PUMP.has(String(t.gmgn?.platform || "").toLowerCase()) || /pump$/.test(t.address || "");

export function passesFilters(t) {
  const f = CFG.filters;
  const g = t.gmgn;
  const mcap = t.mcap || t.fdv || 0;
  if (!t.priceUsd) return "no price";
  if (f.pumpFunOnly && !isPumpFun(t)) return "not a pump.fun token";
  if (mcap < f.minMcapUsd) return `mcap below $${(f.minMcapUsd / 1000).toFixed(0)}k`;
  if (t.ageMin > f.maxAgeH * 60) return "too old";
  if (t.ageMin < f.minAgeMin) return "too new";
  if (t.vol.h1 < f.minVol1hUsd) return "dead volume";
  if (t.chg.m5 < -12) return "dumping right now";
  if (g) {
    if (g.wash) return "wash trading";
    if (g.rug != null && g.rug > f.maxRug) return "rug risk";
    if (g.top10 != null && g.top10 > f.maxTop10) return "top 10 holders too heavy";
    if (g.bundler != null && g.bundler > f.maxBundler) return "bundled supply";
    if (!g.mintRenounced || !g.freezeRenounced) return "mint or freeze not renounced";
    if (g.socialReuse > f.maxSocialReuse) return "recycled socials";
  }
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
  const g0 = t.gmgn || {};
  const social = clamp(
    (t.socials.twitter || g0.twitter ? 0.3 : 0) + (t.socials.telegram || g0.telegram ? 0.15 : 0) + (t.socials.website || g0.website ? 0.15 : 0) -
    (g0.socialReuse > 2 ? 0.25 : 0) - (g0.websiteDup > 3 ? 0.15 : 0) - (/communities|status/.test(g0.twitter || "") ? 0.1 : 0) +
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
