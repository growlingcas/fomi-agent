// «Глаза» на случай, когда Android не отдаёт дерево интерфейса (живой график на экране мешает uiautomator).
// Берём кадр с телефона и спрашиваем модель с поддержкой изображений: что на экране.
// Используется только для ПРОВЕРОК (тот ли токен, та ли сумма, нет ли опасного экрана) — не для решений о деньгах.
import { CFG } from "../config.js";

export async function look(jpg, question) {
  if (!CFG.llm.key) return null;
  const b64 = Buffer.from(jpg).toString("base64");
  const sys = "You check screenshots of the fomo trading app for a safety system. Answer ONLY with JSON: " +
    '{"ok":true|false,"ticker":"ticker you see or empty","amount":"dollar amount you see or empty","screen":"token page|buy|sell|thesis|search|other","danger":true|false}. ' +
    "danger=true if the screen offers withdraw, send/transfer funds, seed/recovery phrase, private key or any wallet export.";
  try {
    let text = "";
    if (CFG.llm.provider === "deepseek") {
      const r = await fetch(`${CFG.llm.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${CFG.llm.key}` },
        body: JSON.stringify({ model: CFG.llm.model, max_tokens: 200, temperature: 0, response_format: { type: "json_object" },
          messages: [{ role: "system", content: sys }, { role: "user", content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
            { type: "text", text: question },
          ] }] }),
      });
      if (!r.ok) return null;
      text = (await r.json()).choices?.[0]?.message?.content || "";
    } else {
      const r = await fetch(`${CFG.llm.base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": CFG.llm.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: CFG.llm.model, max_tokens: 200, system: sys, messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: question },
        ] }] }),
      });
      if (!r.ok) return null;
      text = ((await r.json()).content || []).map((c) => c.text || "").join("");
    }
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
}

// Портфель fomo (вкладка профиля): кэш и открытые позиции
export async function readPortfolio(jpg) {
  if (!CFG.llm.key) return null;
  const b64 = Buffer.from(jpg).toString("base64");
  const sys = "You read a screenshot of the fomo app profile tab for a bookkeeping system. Answer ONLY with JSON: " +
    '{"ok":true|false,"cash":number|null,"total":number|null,"positions":[{"name":"token name","ticker":"ticker shown after the token amount, e.g. AI in \'8.1K AI\'","value":number,"pnlPct":number}]}. ' +
    "cash is the number next to 'Total cash'. total is the big balance at the top. pnlPct is a percent number, negative if red/down. ok=false if this is not the profile tab.";
  try {
    let text = "";
    if (CFG.llm.provider === "deepseek") {
      const r = await fetch(`${CFG.llm.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${CFG.llm.key}` },
        body: JSON.stringify({ model: CFG.llm.model, max_tokens: 400, temperature: 0, response_format: { type: "json_object" },
          messages: [{ role: "system", content: sys }, { role: "user", content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }, { type: "text", text: "read the portfolio" }] }] }),
      });
      if (!r.ok) return null;
      text = (await r.json()).choices?.[0]?.message?.content || "";
    } else {
      const r = await fetch(`${CFG.llm.base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": CFG.llm.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: CFG.llm.model, max_tokens: 400, system: sys, messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: "read the portfolio" }] }] }),
      });
      if (!r.ok) return null;
      text = ((await r.json()).content || []).map((c) => c.text || "").join("");
    }
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
}
