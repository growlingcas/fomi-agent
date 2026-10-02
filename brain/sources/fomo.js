// fomo feed: тезисы и сделки других юзеров по токену.
// TODO: подключить, когда будет документация API fomo (FOMO_API_BASE / FOMO_API_KEY).
import { CFG } from "../config.js";

export async function feed(symbol) {
  if (CFG.mock) {
    const n = Math.floor(Math.random() * 12);
    const lines = ["aping small", "thesis: community is cooking", "took profits", "chart is clean", "bonding curve almost done", "selling half here"];
    return { count: n, sample: Array.from({ length: Math.min(3, n) }, (_, i) => ({ user: "fomoer" + (11 + i * 3), text: `${lines[(n + i) % lines.length]} $${symbol}` })) };
  }
  if (!CFG.fomo.apiBase) return null;
  return null; // ← здесь будет реальный запрос к API fomo
}
