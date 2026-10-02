// Реальные данные с публичного API DexScreener (без ключа).
// Проверь лимиты и формат на https://docs.dexscreener.com — API может меняться.
const BASE = "https://api.dexscreener.com";

async function get(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`dexscreener ${r.status} ${url}`);
  return r.json();
}

export function normalizePair(p, boosted = false) {
  const links = [...(p.info?.socials || []).map((s) => s.type), ...((p.info?.websites || []).length ? ["website"] : [])];
  return {
    address: p.baseToken?.address,
    symbol: (p.baseToken?.symbol || "?").toUpperCase(),
    name: p.baseToken?.name || "",
    pairAddress: p.pairAddress,
    dex: p.dexId,
    priceNative: Number(p.priceNative) || 0,
    priceUsd: Number(p.priceUsd) || 0,
    liqUsd: p.liquidity?.usd || 0,
    fdv: p.fdv || 0,
    mcap: p.marketCap || p.fdv || 0,
    ageMin: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 60000 : 99999,
    vol: { m5: p.volume?.m5 || 0, h1: p.volume?.h1 || 0, h24: p.volume?.h24 || 0 },
    chg: { m5: p.priceChange?.m5 || 0, h1: p.priceChange?.h1 || 0, h24: p.priceChange?.h24 || 0 },
    txns: {
      m5: { b: p.txns?.m5?.buys || 0, s: p.txns?.m5?.sells || 0 },
      h1: { b: p.txns?.h1?.buys || 0, s: p.txns?.h1?.sells || 0 },
    },
    socials: { twitter: links.includes("twitter"), telegram: links.includes("telegram"), website: links.includes("website") },
    boosted,
    url: p.url || `https://dexscreener.com/solana/${p.pairAddress}`,
  };
}

// Берём пары по адресам токенов (до 30 за запрос), оставляем самую ликвидную пару на токен.
export async function pairsFor(addresses, boostedSet = new Set()) {
  const out = new Map();
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const j = await get(`${BASE}/latest/dex/tokens/${chunk.join(",")}`);
    for (const p of j.pairs || []) {
      if (p.chainId !== "solana") continue;
      const t = normalizePair(p, boostedSet.has(p.baseToken?.address));
      const prev = out.get(t.address);
      if (!prev || t.liqUsd > prev.liqUsd) out.set(t.address, t);
    }
  }
  return [...out.values()];
}

// Свежие токены. Если есть GMGN_API_KEY — основной список берём из трендов GMGN
// (там smart money, rug ratio, холдеры), а цены и сделки — с DexScreener.
import * as gmgn from "./gmgn.js";
export async function scan() {
  if (gmgn.enabled()) {
    try {
      const g = await gmgn.trending();
      const byAddr = new Map(g.map((t) => [t.address, t.gmgn]));
      const pairs = await pairsFor(g.map((t) => t.address));
      if (pairs.length) return pairs.map((t) => ({ ...t, gmgn: byAddr.get(t.address) || null, source: "gmgn" }));
    } catch (e) { console.log("gmgn scan failed, fallback to dexscreener:", e.message); }
  }
  const [profiles, boosts] = await Promise.all([
    get(`${BASE}/token-profiles/latest/v1`).catch(() => []),
    get(`${BASE}/token-boosts/latest/v1`).catch(() => []),
  ]);
  const sol = (a) => (Array.isArray(a) ? a : []).filter((x) => x.chainId === "solana").map((x) => x.tokenAddress);
  const boosted = new Set(sol(boosts));
  const addrs = [...new Set([...sol(profiles), ...boosted])].slice(0, 60);
  return pairsFor(addrs, boosted);
}

// Обновить цены по открытым позициям.
export async function quotes(addresses) {
  if (!addresses.length) return new Map();
  const list = await pairsFor(addresses);
  return new Map(list.map((t) => [t.address, t]));
}
