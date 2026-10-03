// Финальное решение и тезис. Если есть ANTHROPIC_API_KEY — спрашивает модель (по умолчанию Haiku, дёшево),
// иначе решает по правилам. Модель видит только цифры, сигналы и свою статистику.
import { CFG } from "./config.js";

const PERSONA = `You are FOMI, an autonomous memecoin trading agent on the fomo app.
Personality: calm, deadpan, slightly bored, precise. Lowercase. No hype, no promises, no price targets as guarantees.
You receive one Solana token's market data, your signal scores (0..1), and your recent performance.
Decide ENTER or SKIP. Be selective: most tokens are SKIP.
Reply with ONLY a JSON object, no markdown:
{"decision":"ENTER"|"SKIP","conviction":0..1,"reasons":["..",".."],"risks":[".."],"thesis":"max 220 chars, lowercase, deadpan, includes $TICKER, ends with 'nfa'"}`;

function ruleBased(t, sig, sc, threshold) {
  const enter = sc >= threshold && sig.safety > 0.45 && sig.buyers > 0.4;
  const strong = Object.entries(sig).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  const weak = Object.entries(sig).sort((a, b) => a[1] - b[1])[0][0];
  return {
    decision: enter ? "ENTER" : "SKIP",
    conviction: Math.max(0, Math.min(1, (sc - threshold + 15) / 30)),
    reasons: strong.map((k) => `${k} ${(sig[k] * 100).toFixed(0)}`),
    risks: [`${weak} weak`],
    thesis: enter
      ? `$${t.symbol}: ${strong[0]} and ${strong[1]} lining up, liq ${(t.liqUsd / 1000).toFixed(0)}k. small size, tight stop. nfa`
      : "",
    by: "rules",
  };
}

// Один запрос к модели. DeepSeek — OpenAI-совместимый /chat/completions, Anthropic — /v1/messages.
async function ask(user) {
  if (CFG.llm.provider === "deepseek") {
    const r = await fetch(`${CFG.llm.base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CFG.llm.key}` },
      body: JSON.stringify({ model: CFG.llm.model, max_tokens: 400, temperature: 0.4, response_format: { type: "json_object" },
        messages: [{ role: "system", content: PERSONA }, { role: "user", content: user }] }),
    });
    if (!r.ok) throw new Error("llm " + r.status);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || "";
  }
  const r = await fetch(`${CFG.llm.base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": CFG.llm.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CFG.llm.model, max_tokens: 400, system: PERSONA, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error("llm " + r.status);
  const j = await r.json();
  return (j.content || []).map((c) => c.text || "").join("");
}

export async function decide(t, sig, sc, brain, stats) {
  const fallback = ruleBased(t, sig, sc, brain.threshold);
  if (!CFG.llm.key || sc < brain.threshold - 8) return fallback;   // слабых даже не показываем модели — экономия
  const payload = {
    token: { symbol: t.symbol, ageMin: Math.round(t.ageMin), liqUsd: Math.round(t.liqUsd), fdv: Math.round(t.fdv),
      vol: t.vol, chg: t.chg, txns: t.txns, socials: t.socials, gmgn: t.gmgn || null },
    signals: Object.fromEntries(Object.entries(sig).map(([k, v]) => [k, +v.toFixed(2)])),
    score: sc, threshold: brain.threshold,
    myStats: { trades: stats.trades, winrate: stats.winrate, streak: stats.streak },
  };
  try {
    const text = (await ask(JSON.stringify(payload))).replace(/```json|```/g, "").trim();
    const out = JSON.parse(text);
    if (!["ENTER", "SKIP"].includes(out.decision)) throw new Error("bad decision");
    // жёсткие правила риска сильнее модели
    if (sig.safety < 0.35) out.decision = "SKIP";
    return { ...fallback, ...out, by: CFG.llm.model };
  } catch (e) {
    return { ...fallback, by: "rules (llm error)" };
  }
}
