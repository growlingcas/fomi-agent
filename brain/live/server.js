// Live-сервер: крутит мозг, снимает экран телефона и отдаёт всё сайту в реальном времени.
//   npm run live
// Эндпоинты (CORS открыт для LIVE_ALLOW_ORIGIN):
//   GET /state      — текущее состояние (банк, позиции, мозг, эпизоды)
//   GET /phone.jpg  — последний кадр экрана телефона (jpeg, если установлен sharp; иначе png)
//   GET /events     — поток событий (SSE): episode, tap, phone-step, log, state
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { CFG, ROOT } from "../config.js";
import { bus } from "../bus.js";
import { tick } from "../index.js";
import { lastState } from "../publish.js";

let frame = null, frameType = "image/png", phoneOk = false, sharp = null;
try { sharp = (await import("sharp")).default; } catch { /* без sharp отдаём png */ }

async function frameLoop() {
  let phone = null;
  try {
    ({ phone } = await import("../phone/index.js"));
    await phone.connect(); phoneOk = true;
    console.log("phone connected");
  } catch (e) { console.log("phone offline:", e.message); }
  for (;;) {
    if (phoneOk) {
      try {
        const img = await phone.screenshot();
        if (phone.frameType === "image/jpeg") { frame = img; frameType = "image/jpeg"; }          // vmos уже отдаёт jpeg
        else if (sharp) { frame = await sharp(img).resize({ width: 540 }).jpeg({ quality: 62 }).toBuffer(); frameType = "image/jpeg"; }
        else frame = img;
      } catch (e) { /* пропускаем кадр */ }
    }
    await new Promise((r) => setTimeout(r, 1000 / Math.max(0.2, CFG.phone.fps)));
  }
}

const clients = new Set();
bus.on("event", (e) => { const msg = `data: ${JSON.stringify(e)}\n\n`; for (const c of clients) c.write(msg); });

const cors = { "access-control-allow-origin": CFG.live.allowOrigin, "cache-control": "no-store" };
http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/state") { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ ...(lastState || {}), phoneOnline: phoneOk })); }
  if (url === "/phone.jpg" || url === "/phone.png") {
    if (!frame) { res.writeHead(503, cors); return res.end("phone offline"); }
    res.writeHead(200, { ...cors, "content-type": frameType }); return res.end(frame);
  }
  if (url === "/events") {
    res.writeHead(200, { ...cors, "content-type": "text/event-stream", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello", phoneOnline: phoneOk })}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res));
    return;
  }
  // всё остальное — сам сайт из docs/, чтобы локально открыть http://localhost:8787 и сразу видеть оба экрана
  const docs = path.join(ROOT, "docs");
  const file = path.normalize(path.join(docs, url === "/" ? "index.html" : decodeURIComponent(url)));
  if (file.startsWith(docs) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const types = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { ...cors, "content-type": types[path.extname(file)] || "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404, cors); res.end("not found");
}).listen(CFG.live.port, () => console.log(`fomi live on :${CFG.live.port}`));

setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 20000);
frameLoop();
for (;;) { await tick(); await new Promise((r) => setTimeout(r, CFG.tickSeconds * 1000)); }
