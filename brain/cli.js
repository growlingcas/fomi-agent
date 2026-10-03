// Управление с сервера:
//   npm run admin -- status            — что сейчас делает агент
//   npm run admin -- on | pause | off  — рубильник (pause: без новых входов, стопы/тейки работают; off: стоит всё)
//   npm run status                     — банк и позиции
//   npm run confirm -- <orderId> [цена] — подтвердить ручной ордер (EXECUTOR=manual)
//   npm run resume                     — снять стоп после просадки
//   npm run reset                      — начать заново с START_BANK_USD
//   npm run stop / unstop              — аварийный стоп любых действий на телефоне
//   npm run phone:ping | phone:snap | phone:debug | phone:resize
//   npm run phone:test -- <CA> <TICKER> [usd] — прогон покупки без финального свайпа
import fs from "node:fs";
import { CFG } from "./config.js";
import { loadBank, saveBank, priceOf } from "./bank.js";
import { loadJournal, saveJournal, pushEvent } from "./memory.js";
import { loadBrain } from "./learn.js";
import { publish } from "./publish.js";
import { getControl, setControl } from "./control.js";

const [cmd, a, b] = process.argv.slice(2);
const done = () => process.exit(0);

if (cmd === "admin") {
  if (a && a !== "status") { const c = setControl(a, "cli"); console.log(`agent is now: ${c.mode}`); }
  const c = getControl();
  const bank = loadBank();
  console.log({ mode: c.mode, since: c.at ? new Date(c.at).toISOString() : "-", dryRun: CFG.phone.dryRun, executor: CFG.executor,
    cash: bank.cash, open: bank.positions.map((p) => `$${p.symbol} $${p.size}`), halted: bank.halted, stopFile: fs.existsSync(`${CFG.paths.data}/STOP`) });
  done();
}

const bank = loadBank();
const journal = loadJournal();

if (cmd === "status") {
  console.log({ cash: bank.cash, positions: bank.positions.map((p) => [p.symbol, p.size, p.remaining]), orders: bank.orders, halted: bank.halted, control: getControl().mode });
} else if (cmd === "confirm") {
  const { closePosition } = await import("./index.js");
  const o = bank.orders.find((x) => x.id === a);
  if (!o) { console.error("no such order"); process.exit(1); }
  const price = b ? Number(b) : o.refPrice;
  if (o.side === "buy") {
    bank.cash -= o.size;
    bank.positions.push({ id: "p" + Date.now().toString(36), address: o.address, symbol: o.symbol, url: o.url,
      entryPrice: price, entryMcap: o.entryMcap || 0, lastPrice: price, size: o.size, tokens: (o.size * (1 - CFG.bank.feePct)) / price,
      remaining: 1, peak: price, tp1Done: false, openedAt: Date.now(), ...o.meta });
    pushEvent({ type: "buy", symbol: o.symbol, size: o.size, manual: true });
  } else {
    const pos = bank.positions.find((p) => p.id === o.posId);
    if (pos) {
      const portion = pos.remaining * o.pct;
      const proceeds = pos.tokens * portion * price * (1 - CFG.bank.feePct);
      bank.cash += proceeds;
      pos.realized = (pos.realized || 0) + proceeds - pos.size * portion;
      pos.remaining -= portion;
      if (o.reason === "tp1") pos.tp1Done = true;
      if (pos.remaining <= 0.001) closePosition(bank, journal, pos, o.reason);
    }
  }
  bank.orders = bank.orders.filter((x) => x.id !== o.id);
  console.log("confirmed", o.id);
} else if (cmd === "sync") {
  // сверка с fomo прямо сейчас: кэш и позиции
  const { syncWithFomo } = await import("./index.js");
  const pf = await syncWithFomo(bank, journal, true);
  console.log(pf ? { cash: bank.cash, positions: pf.positions, mine: bank.positions.map((p) => p.symbol), notMine: bank.external } : "sync failed — see events");
} else if (cmd === "phone-ping") {
  const { phone } = await import("./phone/index.js");
  try {
    const sz = await phone.connect();
    console.log("phone ok, screen", sz);
    const img = await phone.screenshot();
    fs.mkdirSync(`${CFG.paths.data}/phone`, { recursive: true });
    fs.writeFileSync(`${CFG.paths.data}/phone/ping.jpg`, img);
    console.log("frame saved to brain/data/phone/ping.jpg", img.length, "bytes");
  } catch (e) { console.error("phone error:", e.message); process.exit(1); }
  done();
} else if (cmd === "phone-debug") {
  const v = await import("./phone/vmos-api.js");
  console.log("wm size →", (await v.sh("wm size", true)).trim());
  console.log("fomo package →", (await v.sh("pm list packages | grep -i fomo", true)).trim());
  const ui = await v.dumpUi();
  console.log("ui elements on screen →", ui.nodes.filter((n) => n.text).length, ui.nodes.filter((n) => n.text).slice(0, 15).map((n) => n.text).join(" | "));
  done();
} else if (cmd === "phone-resize") {
  const { phone } = await import("./phone/index.js");
  if (!phone.sh) { console.error("works with PHONE_TRANSPORT=vmos"); process.exit(1); }
  const out = a === "reset" ? await phone.sh("wm size reset; wm density reset; wm size", true) : await phone.sh(`wm size ${a || "1080x2340"}; wm size`, true);
  console.log(out || "done"); done();
} else if (cmd === "phone-snap") {
  const app = await import("./phone/fomo-app.js");
  await app.snap(); done();
} else if (cmd === "phone-test") {
  // npm run phone:test -- <CA> <TICKER> [usd] — весь путь покупки БЕЗ финального свайпа
  CFG.phone.dryRun = true;
  const { phone } = await import("./phone/index.js");
  const app = await import("./phone/fomo-app.js");
  await phone.connect();
  console.log(await app.buy({ address: a, symbol: String(b || "").toUpperCase(), usd: Number(process.argv[5] || CFG.bank.minPos) }));
  done();
} else if (cmd === "stop") {
  fs.writeFileSync(`${CFG.paths.data}/STOP`, String(Date.now())); console.log("STOP set — phone actions halted"); done();
} else if (cmd === "unstop") {
  fs.rmSync(`${CFG.paths.data}/STOP`, { force: true }); console.log("STOP removed"); done();
} else if (cmd === "resume") {
  bank.halted = false; bank.pausedUntil = 0; console.log("resumed");
} else if (cmd === "reset") {
  for (const f of ["bank", "journal", "events", "episodes", "brain", "outbox", "mock_world"]) fs.rmSync(`${CFG.paths.data}/${f}.json`, { force: true });
  console.log("reset to $" + CFG.bank.start); done();
} else {
  console.log("commands: admin [status|on|pause|off] | status | sync | confirm <orderId> [price] | resume | reset | stop | unstop | phone-ping | phone-snap | phone-debug | phone-resize | phone-test <CA> <TICKER> [usd]");
  done();
}
saveBank(bank); saveJournal(journal);
publish(bank, loadBrain(), journal, new Map(), getControl());
