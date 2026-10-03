// Конфиг мозга. Читает .env без зависимостей.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*)/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const num = (k, d) => Number(env(k, d));

export const CFG = {
  executor: env("EXECUTOR", "paper"),
  mock: env("MOCK", "0") === "1",
  tickSeconds: num("TICK_SECONDS", 120),

  // Банк в долларах — fomo торгует в USD. Минимальный ордер fomo $2 (и на покупку, и на продажу),
  // поэтому позиция не меньше $3: даже после стопа −25% её можно закрыть.
  bank: {
    unit: "usd",
    start: num("START_BANK_USD", 15),
    reserve: num("RESERVE_USD", 1),               // не торгуется никогда
    minPos: num("MIN_POSITION_USD", 3),
    maxPos: num("MAX_POSITION_USD", 5),
    minOrder: num("FOMO_MIN_ORDER_USD", 2),       // ограничение fomo
    maxOpen: num("MAX_OPEN_POSITIONS", 3),
    maxExposurePct: num("MAX_EXPOSURE_PCT", 0.9), // доля торгуемого банка, которая может быть в рынке
    basePct: num("BASE_PCT", 0.25),               // размер = торгуемый банк × basePct × (0.5 + уверенность)
    dailyLossLimit: num("DAILY_LOSS_LIMIT_USD", 4),
    haltEquity: num("HALT_EQUITY_USD", 6),        // ниже — полный стоп до `npm run resume`
    lossStreakPause: 3,                           // 3 минуса подряд → пауза
    pauseMinutes: 120,
    reentryCooldownH: 24,                         // в один токен не чаще раза в сутки
    maxEntriesPerHour: num("MAX_ENTRIES_PER_HOUR", 3),
    maxEntriesPerTick: num("MAX_ENTRIES_PER_TICK", 3),
    feePct: 0.005,                                // комиссия fomo 0.5%
  },

  exits: {
    stopLoss: -0.25,                // −25% — закрыть всё
    tp1: 0.6, tp1Sell: 0.5,         // +60% — продать половину, стоп в безубыток
    tp2: 1.5,                       // +150% — закрыть остаток
    trail: 0.3,                     // после TP1 — трейлинг 30% от пика
    timeStopH: 6, timeBand: [-0.1, 0.15],   // 6 часов топчется на месте — выйти
  },

  // Жёсткие фильтры: не проходит хоть один — токен даже не рассматривается
  filters: {
    minMcapUsd: num("MIN_MCAP_USD", 100000),
    pumpFunOnly: env("PUMPFUN_ONLY", "1") !== "0",   // только токены, запущенные на pump.fun
    maxAgeH: 72,
    minAgeMin: 15,
    minVol1hUsd: 20000,
    maxRug: 0.3,
    maxTop10: 0.35,
    maxBundler: 0.3,
    maxSocialReuse: 5,              // X-аккаунт уже использовался под N токенов — мимо
  },

  research: { websiteTimeoutMs: 6000, websiteChars: 900 },
  admin: { token: env("ADMIN_TOKEN", "") },

  llm: (() => {
    // DEEPSEEK_API_KEY задан → DeepSeek (deepseek-flash, OpenAI-совместимый API), иначе Anthropic
    const ds = env("DEEPSEEK_API_KEY", "");
    const provider = env("LLM_PROVIDER", ds ? "deepseek" : "anthropic");
    let model = env("LLM_MODEL", "");
    if (provider === "deepseek" && (!model || model.startsWith("claude"))) model = "deepseek-flash";
    if (provider === "anthropic" && !model) model = "claude-haiku-4-5-20251001";
    return { provider, model, key: provider === "deepseek" ? ds : env("ANTHROPIC_API_KEY", ""),
      base: env("LLM_BASE_URL", provider === "deepseek" ? "https://api.deepseek.com" : "https://api.anthropic.com") };
  })(),

  x: {
    post: env("X_POST", "0") === "1",
    userToken: env("X_USER_TOKEN", ""),
    bearer: env("X_BEARER_TOKEN", ""),
    base: env("X_API_BASE", "https://api.twitter.com"),
    handle: env("X_HANDLE", "fomi"),
  },

  phone: {
    transport: env("PHONE_TRANSPORT", "vmos"),       // vmos (OpenAPI) | adb
    serial: env("PHONE_SERIAL", ""),                 // напр. 1.2.3.4:5555 для облачного телефона
    dryRun: env("PHONE_DRY_RUN", "1") !== "0",       // 1 = не жмёт финальное подтверждение
    stepDelayMs: num("PHONE_STEP_DELAY_MS", 900),
    fps: num("PHONE_FPS", 1),
    width: num("PHONE_WIDTH", 720), height: num("PHONE_HEIGHT", 1280),
    vmosAk: env("VMOS_AK", ""), vmosSk: env("VMOS_SK", ""), padCode: env("VMOS_PAD_CODE", ""),
  },
  live: { port: num("LIVE_PORT", 8787), allowOrigin: env("LIVE_ALLOW_ORIGIN", "*") },

  fomo: { url: env("FOMO_URL", "https://fomo.family"), site: "https://fomo.family", apiBase: env("FOMO_API_BASE", ""), apiKey: env("FOMO_API_KEY", "") },
  githubUrl: env("GITHUB_URL", "https://github.com/you/fomi-agent"),

  paths: {
    data: path.join(ROOT, "brain", "data"),
    state: path.join(ROOT, "docs", "state.json"),
  },
};
