// FOMI brain — главный цикл.
//   node brain/index.js          — крутится бесконечно (тик раз в TICK_SECONDS)
//   node brain/index.js --once   — один тик
import { CFG } from "./config.js";
import * as dex from "./sources/dexscreener.js";
import * as mock from "./sources/mock.js";
import { mentions } from "./sources/x.js";
import { feed } from "./sources/fomo.js";
import { research } from "./research.js";
import { SIGNALS, passesFilters, computeSignals, score } from "./signals.js";
import { loadBrain, learnFromTrade } from "./learn.js";
import { decide } from "./llm.js";
import { loadBank, saveBank, equity, gate, sizeFor, exitCheck, recordClose, priceOf, valueOf } from "./bank.js";
import { loadJournal, saveJournal, stats, pushEvent, pushEpisode } from "./memory.js";
import { getControl } from "./control.js";
import { post, entryTweet, exitTweet } from "./xposter.js";
import { publish } from "./publish.js";

const market = CFG.mock ? mock : dex;
const exec = await import(`./executor/${CFG.mock && CFG.executor === "phone" ? "paper" : CFG.executor}.js`);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), "│", ...a);
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "m" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : Math.round(n) + "");
const age = (m) => (m < 60 ? Math.round(m) + "m" : m < 1440 ? (m / 60).toFixed(0) + "h" : (m / 1440).toFixed(0) + "d");
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(0) + "%";

// строки «как на экране скринера» — сайт показывает их в стриме
const row = (t) => `${pad("$" + t.symbol, 10)} ${pad(age(t.ageMin), 5)} mc ${pad(k(t.mcap || t.fdv), 6)} liq ${pad(k(t.liqUsd), 6)} vol1h ${pad(k(t.vol.h1), 6)} ${pad(pct(t.chg.h1 / 100), 6)} b/s ${t.txns.h1.b}/${t.txns.h1.s}`;
const gRow = (t) => { const g = t.gmgn || {};
  return `${pad("$" + t.symbol, 10)} ${pad(age(t.ageMin), 5)} mc ${pad(k(t.mcap || t.fdv), 6)} liq ${pad(k(t.liqUsd), 6)} ${pad(pct(t.chg.h1 / 100), 6)} smart ${pad(g.smart ?? "-", 3)} kol ${pad(g.kol ?? "-", 3)} rug ${g.rug != null ? g.rug.toFixed(2) : "-"}`; };

async function manageOpen(bank, journal, prices) {
  for (const pos of [...bank.positions]) {
    const t = prices.get(pos.address);
    if (!t) continue;
    const price = priceOf(t);
    pos.lastPrice = price;
    pos.lastMcap = t.mcap || t.fdv || pos.lastMcap;
    const ex = exitCheck(pos, price);
    if (!ex) continue;
    if (ex.stuck) {
      if (!pos.stuckNoted) { pushEvent({ type: "stuck", symbol: pos.symbol, text: `$${pos.symbol} worth under $${CFG.bank.minOrder} — fomo won't sell it, holding` }); pos.stuckNoted = true; }
      continue;
    }
    let res;
    try { res = await exec.sell(bank, pos, ex.pct, t, ex.reason); }
    catch (e) { pushEvent({ type: "error", text: `sell $${pos.symbol} failed: ${e.message}` }); log("sell failed", e.message); continue; }
    if (!res.filled) { log("sell not filled", pos.symbol, ex.reason, res.dry ? "(dry run)" : ""); continue; }
    if (ex.reason === "tp1") pos.tp1Done = true;
    pushEvent({ type: "exit", symbol: pos.symbol, reason: ex.reason, pct: ex.pct, pnlPct: price / pos.entryPrice - 1 });
    log("exit", pos.symbol, ex.reason, `${(ex.pct * 100).toFixed(0)}%`);
    if (pos.remaining <= 0.001) closePosition(bank, journal, pos, ex.reason);
  }
}

export function closePosition(bank, journal, pos, reason) {
  bank.positions = bank.positions.filter((p) => p.id !== pos.id);
  const pnl = +(pos.realized || 0).toFixed(4);
  const pnlPct = +(pnl / pos.size).toFixed(4);
  const trade = { symbol: pos.symbol, address: pos.address, size: pos.size, pnl, pnlPct, reason,
    openedAt: pos.openedAt, closedAt: Date.now(), score: pos.score, signals: pos.signals, thesis: pos.thesis };
  journal.push(trade);
  recordClose(bank, pnl);
  const lesson = learnFromTrade(trade, journal);
  pushEvent({ type: "learn", text: lesson });
  post(exitTweet(pos.symbol, pnlPct, reason));
  log("closed", pos.symbol, pnlPct, "→", lesson);
}

async function hunt(bank, journal, brain, prices, paused) {
  const eq = equity(bank, prices);
  const blocked = paused ? "paused by admin" : gate(bank, eq);
  const scanned = await market.scan();
  pushEvent({ type: "scan", source: CFG.mock ? "mock" : scanned[0]?.source || "dexscreener", count: scanned.length });
  log(`scanned ${scanned.length} tokens`);

  const held = new Set(bank.positions.map((p) => p.address));
  const ranked = scanned
    .filter((t) => !held.has(t.address))
    .map((t) => ({ t, why: passesFilters(t) }))
    .map((x) => ({ ...x, pre: x.why ? 0 : score(computeSignals(x.t), brain.weights) }))
    .sort((a, b) => b.pre - a.pre);

  const screen = ranked.slice(0, 12).map((x) => x.t);
  const st = stats(journal);
  let entered = 0;

  for (const { t, why } of ranked.slice(0, 4)) {
    if (why) break;
    const [xs, fs, rs] = await Promise.all([mentions(t.symbol), feed(t.symbol), research(t)]);
    const sig = computeSignals(t, { x: xs, fomo: fs });
    const sc = score(sig, brain.weights);
    const d = await decide(t, sig, sc, brain, st, rs);
    let action = d.decision, size = null;

    if (action === "ENTER") {
      const why2 = blocked || (entered >= CFG.bank.maxEntriesPerTick ? "max entries this round" : null) || gate(bank, eq);
      size = why2 ? null : sizeFor(bank, eq, d.conviction, t.address);
      if (!size) { action = "SKIP"; d.risks = [...(d.risks || []), why2 || "bank says no"]; }
    }
    const e = CFG.exits;
    const mc = t.mcap || t.fdv || 0;
    const plan = action === "ENTER" ? {
      entryMcap: mc, size,
      sl: { pct: e.stopLoss, mcap: mc * (1 + e.stopLoss) },
      tp1: { pct: e.tp1, mcap: mc * (1 + e.tp1), sell: e.tp1Sell },
      tp2: { pct: e.tp2, mcap: mc * (1 + e.tp2) },
      trail: e.trail, timeStopH: e.timeStopH, note: d.plan || "",
    } : null;

    // эпизод для стрима на сайте: что она открыла, куда смотрела, что решила
    const site = rs.website;
    pushEpisode({
      symbol: t.symbol, url: t.url, address: t.address,
      pages: [
        t.source === "gmgn"
          ? { source: "gmgn", url: "gmgn.ai/trend?chain=sol", title: "trending · solana · 1h", lines: screen.map(gRow), focus: [screen.indexOf(t)] }
          : { source: CFG.mock ? "mock screener" : "dexscreener", url: CFG.mock ? "mock://new-pairs" : "dexscreener.com/solana", lines: screen.map(row), focus: [screen.indexOf(t)] },
        ...(t.gmgn ? [{ source: "gmgn token", url: `gmgn.ai/sol/token/${t.address}`, title: `$${t.symbol} · holders & risk`, lines: [
          `holders ${t.gmgn.holders ?? "-"}   top10 ${t.gmgn.top10 != null ? (t.gmgn.top10 * 100).toFixed(0) + "%" : "-"}`,
          `smart money ${t.gmgn.smart}   kol ${t.gmgn.kol}   snipers ${t.gmgn.snipers ?? "-"}`,
          `rug ratio ${t.gmgn.rug ?? "-"}   bundlers ${t.gmgn.bundler != null ? (t.gmgn.bundler * 100).toFixed(0) + "%" : "-"}`,
          `dev ${t.gmgn.devHolds ? "still holding" : "sold / closed"}   mint ${t.gmgn.mintRenounced ? "renounced" : "ACTIVE"}   freeze ${t.gmgn.freezeRenounced ? "renounced" : "ACTIVE"}`,
          `platform ${t.gmgn.platform || "-"}`], focus: [1, 3] }] : []),
        { source: "project", url: site?.url || rs.twitter?.url || "no website", title: `$${t.symbol} · project`, lines: [
          `name ${rs.name || t.symbol}`,
          `website ${site ? site.kind + (site.title ? " · " + site.title.slice(0, 60) : "") : "none"}`,
          `x ${rs.twitter ? rs.twitter.kind + (rs.twitter.handle ? " @" + rs.twitter.handle : "") : "none"}`,
          ...(rs.description ? [`about ${rs.description.slice(0, 110)}`] : []),
          ...(rs.flags.length ? rs.flags.map((f) => `flag ${f}`) : ["flags none"]),
        ], focus: [1, 2] },
        ...(xs ? [{ source: "x", url: `x.com/search?q=$${t.symbol}`, lines: xs.sample.length ? xs.sample.map((s) => `@${s.user}: ${s.text}`) : ["no mentions yet"], focus: [0] }] : []),
        { source: "chart", url: `${t.url}`, lines: [`price $${priceOf(t).toPrecision(4)}  mc ${k(mc)}`, `chg m5 ${(+t.chg.m5).toFixed(1)}%  h1 ${(+t.chg.h1).toFixed(1)}%  h24 ${(+t.chg.h24).toFixed(1)}%`, `txns m5 ${t.txns.m5.b}b/${t.txns.m5.s}s  h1 ${t.txns.h1.b}b/${t.txns.h1.s}s`, `liq ${k(t.liqUsd)}  age ${age(t.ageMin)}`], focus: [1, 2] },
      ],
      signals: Object.fromEntries(SIGNALS.map((s) => [s, +sig[s].toFixed(3)])),
      score: sc, threshold: brain.threshold, decision: action, conviction: d.conviction, reasons: d.reasons, risks: d.risks,
      plan, thesis: action === "ENTER" ? d.thesis : "", size, by: d.by,
    });
    pushEvent({ type: "decision", symbol: t.symbol, score: sc, decision: action, by: d.by });
    log(`$${t.symbol} score ${sc}/${brain.threshold} → ${action}${size ? " $" + size : ""} (${d.by})`);

    if (action === "ENTER") {
      let res;
      try { res = await exec.buy(bank, t, size, { signals: sig, score: sc, thesis: d.thesis, plan }); }
      catch (e) { pushEvent({ type: "error", text: `buy $${t.symbol} failed: ${e.message}` }); log("buy failed", e.message); continue; }
      bank.lastEntry[t.address] = Date.now();
      if (res.filled || res.order) { bank.entryTimes.push(Date.now()); entered++; }
      pushEvent({ type: res.dry ? "dry-run" : res.filled ? "buy" : "order", symbol: t.symbol, size, thesis: d.thesis });
      if (res.filled) post(entryTweet(t, size, d.thesis));
    }
  }
}

export async function tick() {
  const control = getControl();
  const bank = loadBank();
  const journal = loadJournal();
  const brain = loadBrain();
  let prices = new Map();
  if (control.mode !== "off") {
    try {
      prices = await market.quotes(bank.positions.map((p) => p.address));
      await manageOpen(bank, journal, prices);
      await hunt(bank, journal, brain, prices, control.mode === "pause");
    } catch (e) {
      log("tick error:", e.message);
      pushEvent({ type: "error", text: e.message });
    }
  }
  saveBank(bank);
  saveJournal(journal);
  const s = publish(bank, loadBrain(), journal, prices, control);
  log(`[${control.mode}] equity $${s.bank.equity} · open ${s.positions.length} · gen ${s.brain.generation}`);
}

if (process.argv[1]?.endsWith("index.js")) {
  log(`fomi brain online · executor=${CFG.executor} · mock=${CFG.mock} · llm=${CFG.llm.key ? CFG.llm.model : "rules"}`);
  if (process.argv.includes("--once")) await tick();
  else for (;;) { await tick(); await new Promise((r) => setTimeout(r, CFG.tickSeconds * 1000)); }
}
