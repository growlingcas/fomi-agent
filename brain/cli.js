// Ручное управление:
//   node brain/cli.js status
//   node brain/cli.js confirm <orderId> [priceSol]   — подтвердить ручную покупку/продажу
//   node brain/cli.js resume                          — снять стоп после просадки
//   node brain/cli.js reset                           — начать заново с START_BANK_SOL (paper)
import fs from "node:fs";
import { CFG } from "./config.js";
import { loadBank, saveBank } from "./bank.js";
import { loadJournal, saveJournal, pushEvent } from "./memory.js";
import { loadBrain } from "./learn.js";
import { publish } from "./publish.js";
import { closePosition } from "./index.js";

const [cmd, a, b] = process.argv.slice(2);
const bank = loadBank();
const journal = loadJournal();

if (cmd === "status") {
  console.log({ cash: bank.cash, positions: bank.positions.map((p) => [p.symbol, p.sizeSol, p.remaining]), orders: bank.orders, halted: bank.halted });
} else if (cmd === "confirm") {
  const o = bank.orders.find((x) => x.id === a);
  if (!o) { console.error("no such order"); process.exit(1); }
  const price = b ? Number(b) : o.refPrice;
  if (o.side === "buy") {
    bank.cash -= o.sizeSol;
    bank.positions.push({ id: "p" + Date.now().toString(36), address: o.address, symbol: o.symbol, url: o.url,
      entryPrice: price, lastPrice: price, sizeSol: o.sizeSol, tokens: (o.sizeSol * (1 - CFG.bank.feePct)) / price,
      remaining: 1, peak: price, tp1Done: false, openedAt: Date.now(), ...o.meta });
    pushEvent({ type: "buy", symbol: o.symbol, size: o.sizeSol, manual: true });
  } else {
    const pos = bank.positions.find((p) => p.id === o.posId);
    if (pos) {
      const portion = pos.remaining * o.pct;
      const proceeds = pos.tokens * portion * price * (1 - CFG.bank.feePct);
      bank.cash += proceeds;
      pos.realizedSol = (pos.realizedSol || 0) + proceeds - pos.sizeSol * portion;
      pos.remaining -= portion;
      if (o.reason === "tp1") pos.tp1Done = true;
      if (pos.remaining <= 0.001) closePosition(bank, journal, pos, o.reason);
    }
  }
  bank.orders = bank.orders.filter((x) => x.id !== o.id);
  console.log("confirmed", o.id);
} else if (cmd === "phone-ping") {
  // проверка ключей VMOS и связи с телефоном
  const { phone } = await import("./phone/index.js");
  try {
    const sz = await phone.connect();
    console.log("phone ok, screen", sz);
    const img = await phone.screenshot();
    fs.mkdirSync(`${CFG.paths.data}/phone`, { recursive: true });
    fs.writeFileSync(`${CFG.paths.data}/phone/ping.jpg`, img);
    console.log("frame saved to brain/data/phone/ping.jpg", img.length, "bytes");
  } catch (e) { console.error("phone error:", e.message); process.exit(1); }
  process.exit(0);
} else if (cmd === "phone-debug") {
  // диагностика VMOS: какие команды отдают вывод и как называется пакет fomo
  const v = await import("./phone/vmos-api.js");
  const P = "/vcpcloud/api/padApi";
  const text = "pm list packages | grep -i -E 'fomo|family'; wm size";
  try { console.log("syncCmd", JSON.stringify(await v.call(`${P}/syncCmd`, { padCodes: [CFG.phone.padCode], scriptContent: text }))); } catch (e) { console.log("syncCmd ERR", e.message); }
  const d = await v.call(`${P}/asyncCmd`, { padCodes: [CFG.phone.padCode], scriptContent: text });
  console.log("asyncCmd", JSON.stringify(d));
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    for (const ep of ["executeScriptInfo", "padTaskDetail"]) {
      try { console.log(ep, JSON.stringify(await v.call(`${P}/${ep}`, { taskIds: [d?.taskId] }))); } catch (e) { console.log(ep, "ERR", e.message); }
    }
  }
  process.exit(0);
} else if (cmd === "phone-resize") {
  // экран облачного телефона в обычную форму: npm run phone:resize   (вернуть как было: npm run phone:resize -- reset)
  const { phone } = await import("./phone/index.js");
  if (!phone.sh) { console.error("works with PHONE_TRANSPORT=vmos"); process.exit(1); }
  const out = a === "reset" ? await phone.sh("wm size reset; wm density reset; wm size", true) : await phone.sh(`wm size ${a || "1080x2340"}; wm size`, true);
  console.log(out || "done"); process.exit(0);
} else if (cmd === "phone-snap") {
  const app = await import("./phone/fomo-app.js");
  await app.snap(); process.exit(0);
} else if (cmd === "phone-test") {
  // npm run phone:test -- <CA> <SYMBOL> [sizeSol] — прогон покупки в dry-run, без подтверждения
  process.env.PHONE_DRY_RUN = "1"; CFG.phone.dryRun = true;
  const { phone } = await import("./phone/index.js");
  const app = await import("./phone/fomo-app.js");
  await phone.connect();
  console.log(await app.buy({ address: a, symbol: b, sizeSol: Number(process.argv[5] || CFG.bank.minPos) }));
  process.exit(0);
} else if (cmd === "stop") {
  fs.writeFileSync(`${CFG.paths.data}/STOP`, String(Date.now())); console.log("STOP set — phone actions halted"); process.exit(0);
} else if (cmd === "unstop") {
  fs.rmSync(`${CFG.paths.data}/STOP`, { force: true }); console.log("STOP removed"); process.exit(0);
} else if (cmd === "resume") {
  bank.halted = false; bank.pausedUntil = 0; console.log("resumed");
} else if (cmd === "reset") {
  for (const f of ["bank", "journal", "events", "episodes", "brain", "outbox", "mock_world"]) fs.rmSync(`${CFG.paths.data}/${f}.json`, { force: true });
  console.log("reset to", CFG.bank.start, "sol");
  process.exit(0);
} else {
  console.log("commands: status | confirm <orderId> [price] | resume | reset | phone-ping | phone-snap | phone-test <CA> <SYMBOL> [sol] | stop | unstop");
  process.exit(0);
}
saveBank(bank); saveJournal(journal);
publish(bank, loadBrain(), journal, new Map());
