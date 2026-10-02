// Netlify Function: живой экран облачного телефона VMOS для сайта.
// Ключи берутся из переменных окружения Netlify (Site settings → Environment variables):
//   VMOS_AK, VMOS_SK, VMOS_PAD_CODE
// Сайту отдаётся ТОЛЬКО картинка. Ключи наружу не попадают.
import crypto from "node:crypto";

const BASE = "https://api.vmoscloud.com";
const PATH = "/vcpcloud/api/padApi/getLongGenerateUrl";
let cache = { url: null, exp: 0 };

async function previewUrl() {
  if (cache.url && Date.now() < cache.exp - 60e3) return cache.url;
  const { VMOS_AK, VMOS_SK, VMOS_PAD_CODE } = process.env;
  if (!VMOS_AK || !VMOS_SK || !VMOS_PAD_CODE) throw new Error("VMOS env vars are not set in Netlify");
  const body = JSON.stringify({ padCodes: [VMOS_PAD_CODE], format: "jpg", quality: 70, width: "540" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sign = crypto.createHash("sha256").update(VMOS_SK + ts + PATH + body, "utf8").digest("hex");
  const r = await fetch(BASE + PATH, {
    method: "POST",
    headers: { "X-Access-Key": VMOS_AK, "X-Timestamp": ts, "X-Sign": sign, "Content-Type": "application/json" },
    body,
  });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`vmos ${j.code} ${j.msg || ""}`);
  const d = Array.isArray(j.data) ? j.data[0] : j.data;
  if (!d?.url) throw new Error(`no preview url: ${d?.reason || "unknown"}`);
  cache = { url: d.url, exp: d.expireAt || Date.now() + 10 * 60e3 };
  return cache.url;
}

export default async () => {
  try {
    const url = await previewUrl();
    const img = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
    if (!img.ok) { cache.url = null; throw new Error("preview " + img.status); }
    return new Response(await img.arrayBuffer(), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        "netlify-cdn-cache-control": "public, max-age=2",   // все зрители делят один кадр на 2 секунды
      },
    });
  } catch (e) {
    return new Response("phone offline: " + e.message, { status: 503, headers: { "cache-control": "no-store" } });
  }
};

export const config = { path: "/api/phone.jpg" };
