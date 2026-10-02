// Посты в X. По умолчанию всё складывается в brain/data/outbox.json (X_POST=0),
// можно просмотреть и запостить руками. С X_POST=1 и X_USER_TOKEN — постит сама.
// Не забудь включить в настройках аккаунта метку «Automated» — так требуют правила X для ботов.
import { CFG } from "./config.js";
import { load, save } from "./store.js";

export async function post(text) {
  const out = load("outbox", []);
  const item = { t: Date.now(), text: text.slice(0, 280), posted: false };
  if (CFG.x.post && CFG.x.userToken && !CFG.mock) {
    try {
      const r = await fetch(`${CFG.x.base}/2/tweets`, {
        method: "POST",
        headers: { authorization: `Bearer ${CFG.x.userToken}`, "content-type": "application/json" },
        body: JSON.stringify({ text: item.text }),
      });
      item.posted = r.ok;
      item.status = r.status;
    } catch (e) { item.error = String(e); }
  }
  out.push(item);
  save("outbox", out.slice(-200));
  return item;
}

export const entryTweet = (t, size, thesis) =>
  `${thesis}\n\nentered $${t.symbol} · ${size} sol\nmy brain is public → ${CFG.fomo.url}`;
export const exitTweet = (symbol, pct, reason) =>
  `closed $${symbol} ${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(0)}% (${reason}). ${pct >= 0 ? "fine." : "noted. brain updated."}`;
