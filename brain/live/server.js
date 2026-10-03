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
import crypto from "node:crypto";
import { getControl, setControl, MODES } from "../control.js";

// ── админка: /admin#ТОКЕН. Без ADMIN_TOKEN (≥16 символов) в .env админка выключена. ──
const adminOn = CFG.admin.token && CFG.admin.token.length >= 16;
const okToken = (t) => {
  if (!adminOn || typeof t !== "string") return false;
  const a = crypto.createHash("sha256").update(t).digest(), b = crypto.createHash("sha256").update(CFG.admin.token).digest();
  return crypto.timingSafeEqual(a, b);
};
const fails = new Map();   // простая защита от перебора
const ADMIN_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>fomi admin</title>
<style>body{background:#000;color:#ddd;font:15px ui-monospace,Menlo,monospace;padding:24px;max-width:520px;margin:auto}button{font:inherit;padding:14px 18px;margin:6px 6px 6px 0;border:0;cursor:pointer}
.on{background:#5CF02A}.pause{background:#F5C518}.off{background:#F0306E;color:#fff}#s{margin:18px 0;padding:12px;border:1px solid #333;white-space:pre-wrap}</style>
<h2>fomi · admin</h2><div id=s>loading…</div>
<button class=on onclick="set('on')">on</button><button class=pause onclick="set('pause')">pause</button><button class=off onclick="set('off')">off</button>
<p style="color:#777">on — trades normally<br>pause — researches and protects open positions, no new entries<br>off — everything stops, phone untouched</p>
<script>const t=location.hash.slice(1);const h={"x-admin-token":t,"content-type":"application/json"};
async function load(){const r=await fetch("/admin/state",{headers:h});document.getElementById("s").textContent=r.ok?JSON.stringify(await r.json(),null,2):"wrong token";}
async function set(m){await fetch("/admin/mode",{method:"POST",headers:h,body:JSON.stringify({mode:m})});load();}
load();setInterval(load,5000);</script>`;

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
  if (url === "/admin") { res.writeHead(adminOn ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(adminOn ? ADMIN_PAGE : "admin disabled: set ADMIN_TOKEN (16+ chars) in .env"); }
  if (url === "/admin/state" || url === "/admin/mode") {
    const ip = req.socket.remoteAddress || "?";
    if ((fails.get(ip) || 0) > 20) { res.writeHead(429); return res.end("too many attempts"); }
    if (!okToken(req.headers["x-admin-token"])) { fails.set(ip, (fails.get(ip) || 0) + 1); res.writeHead(401); return res.end("unauthorized"); }
    if (url === "/admin/mode" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1000) req.destroy(); });
      req.on("end", () => {
        try { const { mode } = JSON.parse(body || "{}"); if (!MODES.includes(mode)) throw 0; setControl(mode, "web"); res.writeHead(200); res.end("ok"); }
        catch { res.writeHead(400); res.end("bad mode"); }
      });
      return;
    }
    const st = lastState || {};
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ mode: getControl().mode, dryRun: CFG.phone.dryRun, executor: CFG.executor, phoneOnline: phoneOk,
      bank: st.bank, open: (st.positions || []).map((p) => `$${p.symbol} $${p.size} ${(p.pnlPct * 100).toFixed(1)}%`) }));
  }
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
