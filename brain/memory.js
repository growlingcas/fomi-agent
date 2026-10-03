// Память: журнал сделок, статистика, лента событий для сайта.
import { load, save } from "./store.js";
import { emit } from "./bus.js";

export const loadJournal = () => load("journal", []);
export const saveJournal = (j) => save("journal", j.slice(-500));

export function stats(journal) {
  const n = journal.length;
  const pnl = (t) => t.pnl ?? t.pnlSol ?? 0;
  const wins = journal.filter((t) => pnl(t) > 0);
  const losses = journal.filter((t) => pnl(t) <= 0);
  const sum = (a) => a.reduce((s, t) => s + pnl(t), 0);
  let streak = 0;
  for (let i = n - 1; i >= 0; i--) {
    const w = pnl(journal[i]) > 0;
    if (i === n - 1) streak = w ? 1 : -1;
    else if (w === streak > 0) streak += w ? 1 : -1;
    else break;
  }
  return {
    trades: n,
    winrate: n ? +(wins.length / n).toFixed(3) : 0,
    avgWinPct: wins.length ? +(wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length).toFixed(3) : 0,
    avgLossPct: losses.length ? +(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length).toFixed(3) : 0,
    profitFactor: sum(losses) ? +Math.abs(sum(wins) / sum(losses)).toFixed(2) : wins.length ? 99 : 0,
    best: n ? journal.reduce((a, t) => (t.pnlPct > a.pnlPct ? t : a)) : null,
    worst: n ? journal.reduce((a, t) => (t.pnlPct < a.pnlPct ? t : a)) : null,
    streak,
  };
}

const evKey = "events";
export function pushEvent(e) {
  const ev = load(evKey, []);
  ev.push({ t: Date.now(), ...e });
  emit("log", e);
  save(evKey, ev.slice(-200));
}
export const loadEvents = () => load(evKey, []);

const epKey = "episodes";
export function pushEpisode(ep) {
  const a = load(epKey, []);
  const full = { id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), ...ep };
  a.push(full);
  emit("episode", full);
  save(epKey, a.slice(-20));
}
export const loadEpisodes = () => load(epKey, []);
