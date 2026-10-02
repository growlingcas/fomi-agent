// FOMI brain — главный цикл.
//   node brain/index.js          — крутится бесконечно (тик раз в TICK_SECONDS)
//   node brain/index.js --once   — один тик (для GitHub Actions по расписанию)
import { CFG } from "./config.js";
import * as dex from "./sources/dexscreener.js";
import * as mock from "./sources/mock.js";
import { mentions } from "./sources/x.js";
import { feed } from "./sources/fomo.js";
import { SIGNALS, passesFilters, computeSignals, score } from "./signals.js";
import { loadBrain, learnFromTrade } from "./learn.js";
import { decide } from "./llm.js";
import { loadBank, saveBank, equity, gate, sizeFor, exitCheck, recordClose } from "./bank.js";
import { loadJournal, saveJournal, stats, pushEvent, pushEpisode } from "./memory.js";
import { post, entryTweet, exitTweet } from "./xposter.js";
import { publish } from "./publish.js";

const market = CFG.mock ? mock : dex;
const exec = await import(`./executor/${CFG.mock && CFG.executor === "phone" ? "paper" : CFG.executor}.js`);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), "│", ...a);
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "m" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : Math.round(n) + "");
const age = (m) => (m < 60 ? Math.round(m) + "m" : m < 1440 ? (m / 60).toFixed(0) + "h" : (m / 1440).toFixed(0) + "d");
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

// строка «как на экране скринера» — сайт показывает её в стриме
const gRow = (t) => { const g = t.gmgn || {};
  return `${pad("$" + t.symbol, 10)} ${pad(age(t.ageMin), 5)} mc ${pad(k(t.mcap || t.fdv), 6)} liq ${pad(k(t.liqUsd), 6)} ${pad((t.chg.h1 >= 0 ? "+" : "") + t.chg.h1.toFixed(0) + "%", 6)} smart ${pad(g.smart ?? "-", 3)} kol ${pad(g.kol ?? "-", 3)} rug ${g.rug != null ? g.rug.toFixed(2) : "-"}`; };
const row = (t) => `${pad("$" + t.symbol, 10)} ${pad(age(t.ageMin), 5)} liq ${pad(k(t.liqUsd), 6)} vol1h ${pad(k(t.vol.h1), 6)} ${pad((t.chg.h1 >= 0 ? "+" : "") + t.chg.h1.toFixed(0) + "%", 6)} b/s ${t.txns.h1.b}/${t.txns.h1.s}`;

async function manageOpen(bank, journal, prices) {
  for (const pos of [...bank.positions]) {
    const t = prices.get(pos.address);
    if (!t) continue;
    pos.lastPrice = t.priceNative;
    const ex = exitCheck(pos, t.priceNative);
    if (!ex) continue;
    let res;
    try { res = await exec.sell(bank, pos, ex.pct, t, ex.reason); }
    catch (e) { pushEvent({ type: "error", text: `sell $${pos.symbol} failed: ${e.message}` }); log("sell failed", e.message); continue; }
    if (!res.filled) { log("sell queued", pos.symbol, ex.reason); continue; }
    if (ex.reason === "tp1") pos.tp1Done = true;
    pushEvent({ type: "exit", symbol: pos.symbol, reason: ex.reason, pct: ex.pct, pnlPct: t.priceNative / pos.entryPrice - 1 });
    log("exit", pos.symbol, ex.reason, `${(ex.pct * 100).toFixed(0)}%`);
    if (pos.remaining <= 0.001) closePosition(bank, journal, pos, ex.reason);
  }
}

export function closePosition(bank, journal, pos, reason) {
  bank.positions = bank.positions.filter((p) => p.id !== pos.id);
  const pnlSol = +(pos.realizedSol || 0).toFixed(4);
  const pnlPct = +(pnlSol / pos.sizeSol).toFixed(4);
  const trade = { symbol: pos.symbol, address: pos.address, sizeSol: pos.sizeSol, pnlSol, pnlPct, reason,
    openedAt: pos.openedAt, closedAt: Date.now(), score: pos.score, signals: pos.signals, thesis: pos.thesis };
  journal.push(trade);
  recordClose(bank, pnlSol);
  const lesson = learnFromTrade(trade, journal);
  pushEvent({ type: "learn", text: lesson });
  post(exitTweet(pos.symbol, pnlPct, reason));
  log("closed", pos.symbol, pnlPct, "→", lesson);
}

async function hunt(bank, journal, brain, prices) {
  const eq = equity(bank, prices);
  const blocked = gate(bank, eq);
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

  for (const { t, why } of ranked.slice(0, 3)) {
    if (why) break;
    const [xs, fs] = await Promise.all([mentions(t.symbol), feed(t.symbol)]);
    const sig = computeSignals(t, { x: xs, fomo: fs });
    const sc = score(sig, brain.weights);
    const d = await decide(t, sig, sc, brain, st);
    let action = d.decision, size = null;

    if (action === "ENTER") {
      size = blocked ? null : sizeFor(bank, eq, d.conviction, t.address);
      if (!size) { action = "SKIP"; d.risks = [...(d.risks || []), blocked || "bank says no"]; }
    }

    // эпизод для стрима на сайте: что она открыла, куда смотрела, что решила
    pushEpisode({
      symbol: t.symbol, url: t.url,
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
        ...(xs ? [{ source: "x", url: `x.com/search?q=$${t.symbol}`, lines: xs.sample.length ? xs.sample.map((s) => `@${s.user}: ${s.text}`) : ["no mentions yet"], focus: [0] }] : []),
        ...(fs ? [{ source: "fomo", url: `fomo.family/tokens/solana/${t.address}`, lines: fs.sample.length ? fs.sample.map((s) => `${s.user}: ${s.text}`) : ["no theses yet"], focus: [0] }] : []),
        { source: "chart", url: `${t.url}`, lines: [`price ${t.priceNative.toExponential(3)} sol`, `chg m5 ${(+t.chg.m5).toFixed(1)}%  h1 ${(+t.chg.h1).toFixed(1)}%  h24 ${(+t.chg.h24).toFixed(1)}%`, `txns m5 ${t.txns.m5.b}b/${t.txns.m5.s}s  h1 ${t.txns.h1.b}b/${t.txns.h1.s}s`, `fdv ${k(t.fdv)}  liq ${k(t.liqUsd)}  age ${age(t.ageMin)}`], focus: [1, 2] },
      ],
      signals: Object.fromEntries(SIGNALS.map((s) => [s, +sig[s].toFixed(3)])),
      score: sc, threshold: brain.threshold, decision: action, conviction: d.conviction, reasons: d.reasons, risks: d.risks,
      thesis: action === "ENTER" ? d.thesis : "", size, by: d.by,
    });
    pushEvent({ type: "decision", symbol: t.symbol, score: sc, decision: action, by: d.by });
    log(`$${t.symbol} score ${sc}/${brain.threshold} → ${action}${size ? " " + size + " sol" : ""} (${d.by})`);

    if (action === "ENTER" && entered === 0) {
      let res;
      try { res = await exec.buy(bank, t, size, { signals: sig, score: sc, thesis: d.thesis }); }
      catch (e) { pushEvent({ type: "error", text: `buy $${t.symbol} failed: ${e.message}` }); log("buy failed", e.message); continue; }
      bank.lastEntry[t.address] = Date.now();
      pushEvent({ type: res.dry ? "dry-run" : res.filled ? "buy" : "order", symbol: t.symbol, size, thesis: d.thesis });
      if (!res.dry) post(entryTweet(t, size, d.thesis));
      entered++;
    }
  }
}

export async function tick() {
  const bank = loadBank();
  const journal = loadJournal();
  const brain = loadBrain();
  let prices = new Map();
  try {
    prices = await market.quotes(bank.positions.map((p) => p.address));
    await manageOpen(bank, journal, prices);
    await hunt(bank, journal, brain, prices);
  } catch (e) {
    log("tick error:", e.message);
    pushEvent({ type: "error", text: e.message });
  }
  saveBank(bank);
  saveJournal(journal);
  const s = publish(bank, loadBrain(), journal, prices);
  log(`equity ${s.bank.equity} sol · open ${s.positions.length} · gen ${s.brain.generation}`);
}

if (process.argv[1]?.endsWith("index.js")) {
  log(`fomi brain online · executor=${CFG.executor} · mock=${CFG.mock} · llm=${CFG.llm.key ? CFG.llm.model : "rules"}`);
  if (process.argv.includes("--once")) await tick();
  else for (;;) { await tick(); await new Promise((r) => setTimeout(r, CFG.tickSeconds * 1000)); }
}
