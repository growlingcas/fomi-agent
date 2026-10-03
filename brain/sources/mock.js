// Фейковый рынок для тестов без интернета (MOCK=1). Цены «живут» между тиками.
import { load, save } from "../store.js";

const SYL = ["mo", "ki", "zu", "ra", "pe", "lo", "fi", "ny", "gu", "ta", "bo", "xi", "da", "wo", "su"];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function newToken() {
  const sym = (pick(SYL) + pick(SYL) + (Math.random() < 0.4 ? pick(SYL) : "")).toUpperCase();
  const liq = rnd(15000, 300000);
  return {
    address: "MOCK" + Math.random().toString(36).slice(2, 12) + (Math.random() < 0.8 ? "pump" : ""),
    symbol: sym, name: sym.toLowerCase() + " coin", pairAddress: "PAIR" + Math.random().toString(36).slice(2, 10),
    dex: pick(["raydium", "pumpswap", "meteora"]),
    priceNative: rnd(0.0000005, 0.00005), priceUsd: 0,
    liqUsd: liq, fdv: liq * rnd(2, 15), mcap: 0, ageMin: rnd(5, 4000),
    vol: { m5: rnd(0, 30000), h1: rnd(1000, 250000), h24: rnd(10000, 2e6) },
    chg: { m5: rnd(-15, 25), h1: rnd(-40, 120), h24: rnd(-60, 400) },
    txns: { m5: { b: Math.floor(rnd(10, 120)), s: Math.floor(rnd(0, 70)) }, h1: { b: Math.floor(rnd(20, 900)), s: Math.floor(rnd(10, 700)) } },
    socials: { twitter: Math.random() < 0.7, telegram: Math.random() < 0.5, website: Math.random() < 0.4 },
    boosted: Math.random() < 0.2, drift: rnd(-0.06, 0.08), source: "gmgn",
    gmgn: { smart: Math.floor(rnd(0, 7)), kol: Math.floor(rnd(0, 4)), rug: +rnd(0, 0.35).toFixed(2), top10: +rnd(0.08, 0.4).toFixed(2),
      wash: Math.random() < 0.08, bundler: +rnd(0, 0.4).toFixed(2), snipers: Math.floor(rnd(0, 30)), holders: Math.floor(rnd(80, 3000)),
      devHolds: Math.random() < 0.4, mintRenounced: Math.random() < 0.9, freezeRenounced: Math.random() < 0.9, platform: pick(["Pump.fun", "letsbonk", "pool_meteora"]),
      twitter: Math.random() < 0.5 ? "https://x.com/" + sym.toLowerCase() : "https://x.com/i/communities/19" + Math.floor(rnd(1e6, 9e6)),
      website: Math.random() < 0.5 ? "" : "https://" + sym.toLowerCase() + ".fun", socialReuse: Math.floor(rnd(0, 8)), websiteDup: Math.floor(rnd(0, 5)), name: sym.toLowerCase() + " coin" },
    links: { website: "", twitter: "", telegram: "" }, description: pick(["", "the first meme about " + pick(["cats", "ai agents", "green mornings", "fomo"]), "community takeover. no dev."]),
    url: "https://dexscreener.com/solana/mock",
  };
}

function world() {
  const w = load("mock_world", { tokens: [] });
  while (w.tokens.length < 40) w.tokens.push(newToken());
  for (const t of w.tokens) {                       // случайное блуждание цены
    const shock = Math.random() < 0.05 ? rnd(-0.6, 1.2) : 0;
    t.priceNative = Math.max(1e-9, t.priceNative * (1 + t.drift + rnd(-0.18, 0.2) + shock));
    t.priceUsd = t.priceNative * 150;
    t.mcap = t.fdv;
    t.ageMin += 2;
  }
  if (Math.random() < 0.3) w.tokens.splice(Math.floor(Math.random() * w.tokens.length), 1);
  save("mock_world", w);
  return w.tokens;
}

export async function scan() { return world().slice(0, 30); }
export async function quotes(addresses) {
  const w = load("mock_world", { tokens: [] });
  return new Map(w.tokens.filter((t) => addresses.includes(t.address)).map((t) => [t.address, t]));
}
