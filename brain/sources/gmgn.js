// GMGN через официальный gmgn-cli (https://github.com/GMGNAI/gmgn-skills).
// Для чтения нужен только GMGN_API_KEY (ключ с правом Reading). Торговля через GMGN не используется.
// Даёт то, чего нет на DexScreener: smart money / KOL, rug ratio, топ-10 холдеров, wash trading, бандлеры, статус дева.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CFG, ROOT } from "../config.js";

const local = path.join(ROOT, "node_modules", ".bin", "gmgn-cli");
const bin = fs.existsSync(local) ? [local, []] : ["npx", ["--yes", "gmgn-cli"]];

export const enabled = () => !!process.env.GMGN_API_KEY && !CFG.mock;

function cli(args) {
  return new Promise((res, rej) =>
    execFile(bin[0], [...bin[1], ...args, "--raw"], { timeout: 30000, maxBuffer: 16 << 20, env: process.env }, (err, out, errOut) => {
      if (err) return rej(new Error(`gmgn-cli ${args.slice(0, 2).join(" ")}: ${(errOut || err.message).trim().slice(0, 200)}`));
      try { res(JSON.parse(out)); } catch { rej(new Error("gmgn-cli: bad json")); }
    }));
}

const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

const pick = (t, ...keys) => { for (const k of keys) if (t[k] !== undefined && t[k] !== null && t[k] !== "") return t[k]; return undefined; };

// Приводим и тренды, и «trenches» к одному виду
function norm(t, origin) {
  return {
    address: t.address,
    symbol: (t.symbol || "?").toUpperCase(),
    origin,
    gmgn: {
      priceUsd: num(t.price), mcap: num(pick(t, "market_cap", "usd_market_cap")), liqUsd: num(t.liquidity),
      vol1h: num(pick(t, "volume", "volume_1h")),
      chg1h: num(pick(t, "price_change_percent1h", "price_change_percent")), chg5m: num(t.price_change_percent5m),
      buys: num(pick(t, "buys", "buys_24h")), sells: num(pick(t, "sells", "sells_24h")), holders: num(t.holder_count),
      smart: num(t.smart_degen_count) || 0, kol: num(t.renowned_count) || 0,
      rug: num(t.rug_ratio), top10: num(t.top_10_holder_rate), wash: t.is_wash_trading === true || t.is_wash_trading === 1,
      bundler: num(pick(t, "bundler_rate", "bundler_trader_amount_rate")), snipers: num(t.sniper_count),
      devHolds: t.creator_token_status === "creator_hold",
      mintRenounced: num(t.renounced_mint) === 1 || t.renounced_mint === true,
      freezeRenounced: num(t.renounced_freeze_account) === 1 || t.renounced_freeze_account === true,
      platform: t.launchpad_platform || "", created: num(pick(t, "creation_timestamp", "created_timestamp")),
      twitter: pick(t, "twitter_username", "twitter") || "", website: t.website || "", telegram: t.telegram || "",
      xFollowers: num(t.x_user_follower),
      socialReuse: num(t.twitter_create_token_count) || 0, socialDeletes: num(t.twitter_del_post_token_count) || 0,
      websiteDup: num(t.website_dup) || 0, twitterDup: num(t.twitter_dup) || 0, cto: num(t.cto_flag) === 1 || t.cto_flag === true,
      botRate: num(t.bot_degen_rate), entrapment: num(t.entrapment_ratio), live: t.is_token_live === true,
      name: t.name || "",
    },
  };
}

const PUMP_ARGS = () => (CFG.filters.pumpFunOnly ? ["--platform", "Pump.fun", "--platform", "pump_mayhem", "--platform", "pump_agent", "--platform", "pump_mayhem_agent"] : []);

async function trendingList(interval) {
  const j = await cli(["market", "trending", "--chain", "sol", "--interval", interval, "--order-by", "volume",
    "--limit", "50", "--filter", "not_wash_trading", ...PUMP_ARGS()]);
  return (j?.rank || j?.data?.rank || (Array.isArray(j) ? j : [])).map((t) => norm(t, `trending ${interval}`));
}

// Только что мигрировавшие с бондинг-кривой pump.fun токены
async function migrated() {
  const args = ["market", "trenches", "--chain", "sol", "--type", "completed", "--limit", "40",
    "--min-marketcap", String(CFG.filters.minMcapUsd), "--max-rug-ratio", String(CFG.filters.maxRug), "--sort-by", "volume_1h"];
  if (CFG.filters.pumpFunOnly) args.push("--launchpad-platform", "Pump.fun");
  const j = await cli(args);
  const list = j?.completed || j?.data?.completed || [];
  return list.map((t) => norm(t, "just migrated"));
}

// Три потока: тренды за 1ч, тренды за 5м, свежие миграции. Дубликаты склеиваем.
export async function trending() {
  const parts = await Promise.allSettled([trendingList("1h"), trendingList("5m"), migrated()]);
  const out = new Map();
  for (const p of parts) if (p.status === "fulfilled") for (const t of p.value) if (t.address && !out.has(t.address)) out.set(t.address, t);
  if (!out.size) throw new Error(parts.map((p) => p.reason?.message).filter(Boolean)[0] || "gmgn returned nothing");
  return [...out.values()];
}
