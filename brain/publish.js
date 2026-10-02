// Собирает docs/state.json — сайт читает его и показывает мозг, банк и стрим.
import fs from "node:fs";
import path from "node:path";
import { CFG } from "./config.js";
import { equity, exposure } from "./bank.js";
import { stats, loadEvents, loadEpisodes } from "./memory.js";
import { emit } from "./bus.js";

export let lastState = null;
export function publish(bank, brain, journal, prices) {
  const eq = equity(bank, prices);
  const st = stats(journal);
  const state = {
    updatedAt: Date.now(),
    mode: CFG.mock ? "mock" : CFG.executor === "phone" && CFG.phone.dryRun ? "phone · dry run" : CFG.executor,
    llm: CFG.llm.key ? CFG.llm.model : "rules",
    bank: {
      start: bank.start, cash: +bank.cash.toFixed(4), equity: +eq.toFixed(4), reserve: CFG.bank.reserve,
      exposure: +exposure(bank).toFixed(4), pnl: +(eq - bank.start).toFixed(4), pnlPct: +((eq / bank.start - 1)).toFixed(4),
      dayPnl: +bank.day.pnl.toFixed(4), halted: bank.halted, pausedUntil: bank.pausedUntil,
    },
    positions: bank.positions.map((p) => {
      const px = prices.get(p.address)?.priceNative ?? p.lastPrice ?? p.entryPrice;
      return { symbol: p.symbol, address: p.address, url: p.url, sizeSol: p.sizeSol, remaining: +p.remaining.toFixed(2),
        pnlPct: +(px / p.entryPrice - 1).toFixed(4), openedAt: p.openedAt, thesis: p.thesis, score: p.score, tp1Done: p.tp1Done };
    }),
    orders: bank.orders,
    journal: journal.slice(-30).reverse().map((t) => ({ ...t, signals: undefined })),
    rules: { reserve: CFG.bank.reserve, minPos: CFG.bank.minPos, maxPos: CFG.bank.maxPos, maxOpen: CFG.bank.maxOpen,
      dailyLoss: CFG.bank.dailyLossLimit, halt: CFG.bank.haltEquity, stop: CFG.exits.stopLoss, tp1: CFG.exits.tp1, tp2: CFG.exits.tp2, trail: CFG.exits.trail },
    stats: st,
    brain: { generation: brain.generation, threshold: brain.threshold, weights: brain.weights, lessons: brain.lessons.slice(-8).reverse() },
    events: loadEvents().slice(-60),
    episodes: loadEpisodes(),
    links: { fomo: CFG.fomo.url, fomoSite: CFG.fomo.site, x: `https://x.com/${CFG.x.handle}`, github: CFG.githubUrl },
  };
  fs.mkdirSync(path.dirname(CFG.paths.state), { recursive: true });
  fs.writeFileSync(CFG.paths.state, JSON.stringify(state));
  lastState = state;
  emit("state", { bank: state.bank, positions: state.positions, stats: state.stats, brain: state.brain, journal: state.journal, rules: state.rules, mode: state.mode });
  return state;
}
