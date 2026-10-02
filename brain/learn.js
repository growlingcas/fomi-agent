// Обучение мозга. После каждой закрытой сделки:
//  - веса сигналов, которые были высокими в прибыльной сделке, растут; в убыточной — падают;
//  - порог входа сдвигается по винрейту последних 20 сделок.
// Каждое обновление = новое «поколение» мозга. Всё пишется в brain/data/brain.json и видно на сайте.
import { SIGNALS } from "./signals.js";
import { load, save } from "./store.js";

const DEFAULT = {
  generation: 0,
  threshold: 62,
  lr: 0.15,
  weights: { momentum: 1.2, volume: 1.1, buyers: 1.3, liquidity: 0.9, freshness: 0.7, social: 0.8, smart: 1.2, safety: 1.4 },
  lessons: [],
};

export const loadBrain = () => {
  const b = load("brain", DEFAULT);
  for (const k of SIGNALS) if (b.weights[k] === undefined) b.weights[k] = DEFAULT.weights[k] ?? 1;   // новые сигналы
  return b;
};

export function learnFromTrade(trade, journal) {
  const b = loadBrain();
  const reward = Math.max(-1, Math.min(2, trade.pnlPct));
  const changes = {};
  for (const k of SIGNALS) {
    const s = trade.signals?.[k] ?? 0.5;
    const d = b.lr * reward * (s - 0.5);
    b.weights[k] = +Math.max(0.2, Math.min(3, (b.weights[k] ?? 1) + d)).toFixed(4);
    changes[k] = +d.toFixed(4);
  }
  const last = journal.slice(-20);
  if (last.length >= 8) {
    const wr = last.filter((t) => t.pnlPct > 0).length / last.length;
    if (wr < 0.35) b.threshold = Math.min(85, b.threshold + 1);
    if (wr > 0.55) b.threshold = Math.max(55, b.threshold - 1);
  }
  const top = Object.entries(changes).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1]))[0];
  const lesson = `gen ${b.generation + 1}: $${trade.symbol} ${trade.pnlPct >= 0 ? "+" : ""}${(trade.pnlPct * 100).toFixed(0)}% → ${top[0]} ${top[1] >= 0 ? "↑" : "↓"}`;
  b.generation += 1;
  b.lessons = [...b.lessons, { t: Date.now(), text: lesson }].slice(-30);
  save("brain", b);
  return lesson;
}
