// Разбор дампа интерфейса Android (uiautomator) в список элементов с координатами.
export function parseUi(xml) {
  const nodes = [];
  for (const m of (xml || "").matchAll(/<node [^>]*>/g)) {
    const a = (k) => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || "";
    const b = a("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({ text: a("text"), desc: a("content-desc"), id: a("resource-id"), clickable: a("clickable") === "true",
      x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 });
  }
  return nodes;
}
