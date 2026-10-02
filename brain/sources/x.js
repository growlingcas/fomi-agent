// X (twitter): поиск упоминаний тикера. Нужен X_BEARER_TOKEN с доступом к recent search.
// Без токена возвращает null — мозг просто не учитывает этот сигнал.
import { CFG } from "../config.js";

export async function mentions(symbol) {
  if (CFG.mock) {
    const n = Math.floor(Math.random() * 40);
    const said = ["chart looks alive", "dev still here?", "who is buying this", "volume picking up", "rug vibes ngl", "cto forming", "clean bonding curve"];
    return { count: n, sample: Array.from({ length: Math.min(4, n) }, (_, i) => ({ user: "anon" + (100 + i * 7), text: `$${symbol} ${said[(n + i) % said.length]}` })) };
  }
  if (!CFG.x.bearer) return null;
  try {
    const q = encodeURIComponent(`$${symbol} -is:retweet lang:en`);
    const r = await fetch(`${CFG.x.base}/2/tweets/search/recent?query=${q}&max_results=10`, {
      headers: { authorization: `Bearer ${CFG.x.bearer}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return { count: j.meta?.result_count || 0, sample: (j.data || []).slice(0, 4).map((t) => ({ user: "x", text: t.text.slice(0, 120) })) };
  } catch { return null; }
}
