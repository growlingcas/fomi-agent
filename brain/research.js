// Ресёрч проекта перед входом: сайт, X, описание, «чистота» соцсетей по данным GMGN.
// Всё, что приходит отсюда, — ЧУЖИЕ данные (их пишут создатели токенов). В промте они помечены как untrusted.
import { CFG } from "./config.js";
import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i];
const isPrivate = (ip) => PRIVATE.some((r) => r.test(ip));

// Защита от SSRF: сайт токена не должен заставить сервер стучаться в localhost / внутреннюю сеть
async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null;
  try {
    const ips = net.isIP(u.hostname) ? [u.hostname] : (await dns.lookup(u.hostname, { all: true })).map((a) => a.address);
    if (!ips.length || ips.some(isPrivate)) return null;
  } catch { return null; }
  return u;
}

async function website(raw) {
  const u = await safeUrl(raw);
  if (!u) return null;
  if (/^(x|twitter|t)\.(com|me)$|tiktok\.com$|instagram\.com$|youtube\.com$/i.test(u.hostname.replace(/^www\./, "")))
    return { url: u.href, kind: "social link, not a website" };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CFG.research.websiteTimeoutMs);
    const r = await fetch(u.href, { signal: ctl.signal, redirect: "manual", headers: { "user-agent": "fomi-research/1.0" } });
    clearTimeout(timer);
    if (r.status >= 300 && r.status < 400) return { url: u.href, kind: "redirects elsewhere" };
    if (!r.ok) return { url: u.href, kind: `http ${r.status}` };
    const html = (await r.text()).slice(0, 300000);
    const title = (html.match(/<title[^>]*>([^<]{0,140})/i) || [])[1] || "";
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i) || [])[1] || "";
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, CFG.research.websiteChars);
    return { url: u.href, kind: "website", title: title.trim(), description: desc.trim(), text };
  } catch { return { url: u.href, kind: "unreachable" }; }
}

function twitter(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (/\/i\/communities\//.test(s)) return { url: s, kind: "x community (no own account)" };
  if (/\/status\//.test(s)) return { url: s, kind: "links to someone else's tweet (no own account)" };
  const handle = (s.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) || [])[1];
  return handle ? { url: s, kind: "x account", handle } : { url: s, kind: "unknown link" };
}

export async function research(t) {
  const g = t.gmgn || {};
  const site = g.website || t.links?.website || "";
  const tw = g.twitter || t.links?.twitter || "";
  const flags = [];
  if (g.socialReuse > 2) flags.push(`x account reused for ${g.socialReuse} tokens`);
  if (g.socialDeletes > 3) flags.push(`creator deleted ${g.socialDeletes} token posts before`);
  if (g.websiteDup > 3) flags.push(`website copied by ${g.websiteDup} other tokens`);
  if (g.devHolds) flags.push("dev still holds");
  if (g.bundler > 0.2) flags.push(`bundlers ${(g.bundler * 100).toFixed(0)}%`);
  if (g.botRate > 0.6) flags.push(`bot traders ${(g.botRate * 100).toFixed(0)}%`);
  if (g.cto) flags.push("community takeover");
  if (!site && !tw) flags.push("no website, no x");
  return {
    name: g.name || t.name || "",
    description: (t.description || "").slice(0, 400),
    website: site ? await website(site) : null,
    twitter: twitter(tw),
    flags,
  };
}
