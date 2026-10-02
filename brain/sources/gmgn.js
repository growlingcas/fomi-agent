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

// Трендовые токены Solana за час, без wash trading
export async function trending() {
  const j = await cli(["market", "trending", "--chain", "sol", "--interval", "1h", "--order-by", "volume",
    "--limit", "60", "--filter", "not_wash_trading"]);
  const list = j?.rank || j?.data?.rank || (Array.isArray(j) ? j : []);
  return list.map((t) => ({
    address: t.address,
    symbol: (t.symbol || "?").toUpperCase(),
    gmgn: {
      priceUsd: num(t.price), mcap: num(t.market_cap), liqUsd: num(t.liquidity), vol1h: num(t.volume),
      chg1h: num(t.price_change_percent1h ?? t.price_change_percent), chg5m: num(t.price_change_percent5m),
      buys: num(t.buys), sells: num(t.sells), holders: num(t.holder_count),
      smart: num(t.smart_degen_count) || 0, kol: num(t.renowned_count) || 0,
      rug: num(t.rug_ratio), top10: num(t.top_10_holder_rate), wash: t.is_wash_trading === true || t.is_wash_trading === 1,
      bundler: num(t.bundler_rate), snipers: num(t.sniper_count),
      devHolds: t.creator_token_status === "creator_hold",
      mintRenounced: num(t.renounced_mint) === 1, freezeRenounced: num(t.renounced_freeze_account) === 1,
      platform: t.launchpad_platform || "", created: num(t.creation_timestamp),
    },
  })).filter((t) => t.address);
}
