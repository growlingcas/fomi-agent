// «Глаза»: смотрим на скриншот телефона моделью с поддержкой изображений.
// Только для ПРОВЕРОК и чтения баланса — решения о деньгах так не принимаются.
import { askJson } from "../llmcall.js";

export async function look(jpg, question) {
  const sys = "You check screenshots of the fomo trading app for a safety system. Answer ONLY with JSON: " +
    '{"ok":true|false,"ticker":"ticker you see or empty","amount":"dollar amount you see or empty","screen":"token page|buy|sell|thesis|search|profile|other","danger":true|false}. ' +
    "danger=true if the screen offers withdraw, send/transfer funds, seed/recovery phrase, private key or any wallet export.";
  return askJson(sys, question, { image: jpg, maxTokens: 1500, temperature: 0 });
}

// Портфель fomo (вкладка профиля): кэш и открытые позиции
export async function readPortfolio(jpg) {
  const sys = "You read a screenshot of the fomo app profile tab for a bookkeeping system. Answer ONLY with JSON: " +
    '{"ok":true|false,"cash":number|null,"total":number|null,"positions":[{"name":"token name","ticker":"ticker shown after the token amount, e.g. AI in 8.1K AI","value":number,"pnlPct":number}]}. ' +
    "cash is the number next to 'Total cash'. total is the big balance at the top. pnlPct is a percent number, negative if red/down. ok=false if this is not the profile tab.";
  return askJson(sys, "read the portfolio", { image: jpg, maxTokens: 1500, temperature: 0 });
}
