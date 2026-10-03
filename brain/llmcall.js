// Единая точка вызова модели (DeepSeek / Anthropic) — для решений, тезисов, проверок экрана, ревью позиций.
// V4.1 Flash может «думать» перед ответом, поэтому даём запас токенов и достаём JSON откуда бы он ни пришёл.
// Ошибки не глотаем молча: последняя ошибка видна в логе на сайте и в `npm run llm:test`.
import { CFG } from "./config.js";
import { emit } from "./bus.js";

export let lastLlmError = "";
let lastReported = 0;

function report(msg) {
  lastLlmError = msg;
  if (Date.now() - lastReported > 10 * 60e3) { lastReported = Date.now(); emit("log", { type: "error", text: `llm: ${msg}` }); }
}

function extractJson(text) {
  if (!text) return null;
  const clean = text.replace(/```json|```/g, "");
  try { return JSON.parse(clean.trim()); } catch {}
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// system — инструкция, user — строка или массив частей (текст + картинка jpg Buffer)
export async function askJson(system, user, { image = null, maxTokens = 2000, temperature = 0.4 } = {}) {
  if (!CFG.llm.key) { report("no api key"); return null; }
  const b64 = image ? Buffer.from(image).toString("base64") : null;
  try {
    let res, raw;
    if (CFG.llm.provider === "deepseek") {
      const content = b64 ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }, { type: "text", text: user }] : user;
      res = await fetch(`${CFG.llm.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${CFG.llm.key}` },
        body: JSON.stringify({ model: CFG.llm.model, max_tokens: maxTokens, temperature, response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content }] }),
      });
      raw = await res.text();
      if (!res.ok) { report(`${res.status} ${raw.slice(0, 160)}`); return null; }
      const j = JSON.parse(raw);
      const msg = j.choices?.[0]?.message || {};
      const out = extractJson(msg.content) || extractJson(msg.reasoning_content);
      if (!out) report(`no json in reply (finish: ${j.choices?.[0]?.finish_reason || "?"})`);
      return out;
    }
    const content = b64 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: user }] : user;
    res = await fetch(`${CFG.llm.base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": CFG.llm.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: CFG.llm.model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content }] }),
    });
    raw = await res.text();
    if (!res.ok) { report(`${res.status} ${raw.slice(0, 160)}`); return null; }
    const out = extractJson((JSON.parse(raw).content || []).map((c) => c.text || "").join(""));
    if (!out) report("no json in reply");
    return out;
  } catch (e) { report(e.message); return null; }
}
