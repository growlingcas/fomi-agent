// Собирает docs/state.json — сайт читает его и показывает мозг, банк, позиции с планами и стрим.
import fs from "node:fs";
import path from "node:path";
import { CFG } from "./config.js";
import { equity, exposure, levels, priceOf, entriesLastHour } from "./bank.js";
import { stats, loadEvents, loadEpisodes } from "./memory.js";
import { emit } from "./bus.js";

export let lastState = null;
const r2 = (x) => +(+x || 0).toFixed(2);

export function publish(bank, brain, journal, prices, control = { mode: "on" }) {
  const eq = equity(bank, prices);
  const st = stats(journal);
  const positions = bank.positions.map((p) => {
    const px = priceOf(prices.get(p.address)) || p.lastPrice || p.entryPrice;
    const mcNow = prices.get(p.address)?.mcap || p.lastMcap || p.entryMcap || 0;
    const mcAt = (price) => (px ? r2(mcNow * (price / px)) : 0);
    const L = levels(p);
    return {
      symbol: p.symbol, address: p.address, url: p.url, size: r2(p.size), remaining: +p.remaining.toFixed(2),
      value: r2(p.tokens * p.remaining * px), pnlPct: +(px / p.entryPrice - 1).toFixed(4), openedAt: p.openedAt,
      entryMcap: r2(p.entryMcap), mcap: r2(mcNow), tp1Done: p.tp1Done, thesis: p.thesis, score: p.score,
      note: p.plan?.note || "",
      plan: {
        sl: { pct: +(L.sl / p.entryPrice - 1).toFixed(3), mcap: mcAt(L.sl) },
        tp1: { pct: CFG.exits.tp1, mcap: mcAt(L.tp1), done: p.tp1Done },
        tp2: { pct: CFG.exits.tp2, mcap: mcAt(L.tp2) },
        trail: L.trail ? { mcap: mcAt(L.trail) } : null,
      },
    };
  });
  const state = {
    updatedAt: Date.now(),
    unit: "usd",
    control: { mode: control.mode, at: control.at || 0 },
    mode: CFG.mock ? "mock" : CFG.executor === "phone" && CFG.phone.dryRun ? "phone · dry run" : CFG.executor,
    llm: CFG.llm.key ? CFG.llm.model : "rules",
    bank: {
      start: bank.start, cash: r2(bank.cash), equity: r2(eq), reserve: CFG.bank.reserve,
      exposure: r2(exposure(bank)), pnl: r2(eq - bank.start), pnlPct: +((eq / bank.start - 1)).toFixed(4),
      dayPnl: r2(bank.day.pnl), halted: bank.halted, pausedUntil: bank.pausedUntil, entriesLastHour: entriesLastHour(bank),
    },
    positions,
    orders: bank.orders,
    journal: journal.slice(-30).reverse().map((t) => ({ symbol: t.symbol, address: t.address, size: t.size ?? t.sizeSol,
      pnl: t.pnl ?? t.pnlSol, pnlPct: t.pnlPct, reason: t.reason, openedAt: t.openedAt, closedAt: t.closedAt, thesis: t.thesis })),
    rules: {
      unit: "usd", reserve: CFG.bank.reserve, minPos: CFG.bank.minPos, maxPos: CFG.bank.maxPos, maxOpen: CFG.bank.maxOpen,
      dailyLoss: CFG.bank.dailyLossLimit, halt: CFG.bank.haltEquity, stop: CFG.exits.stopLoss, tp1: CFG.exits.tp1, tp2: CFG.exits.tp2,
      trail: CFG.exits.trail, perHour: CFG.bank.maxEntriesPerHour, minMcap: CFG.filters.minMcapUsd, minOrder: CFG.bank.minOrder,
    },
    stats: st,
    brain: { generation: brain.generation, threshold: brain.threshold, weights: brain.weights, lessons: brain.lessons.slice(-8).reverse() },
    events: loadEvents().slice(-60),
    episodes: loadEpisodes(),
    links: { fomo: CFG.fomo.url, fomoSite: CFG.fomo.site, x: `https://x.com/${CFG.x.handle}`, github: CFG.githubUrl },
  };
  fs.mkdirSync(path.dirname(CFG.paths.state), { recursive: true });
  fs.writeFileSync(CFG.paths.state, JSON.stringify(state));
  lastState = state;
  emit("state", { bank: state.bank, positions, stats: st, brain: state.brain, journal: state.journal, rules: state.rules,
    mode: state.mode, control: state.control, unit: "usd" });
  return state;
}
