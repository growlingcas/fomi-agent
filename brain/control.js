// Рубильник агента. Режимы:
//   on    — работает полностью
//   pause — ресёрчит и защищает открытые позиции (стопы/тейки), но НЕ входит в новые
//   off   — полностью стоит: не сканирует, не торгует, телефон не трогает
// Меняется командой `npm run admin -- on|pause|off` или со страницы /admin на live-сервере.
import { load, save } from "./store.js";
import { emit } from "./bus.js";

export const MODES = ["on", "pause", "off"];
export const getControl = () => load("control", { mode: "on", at: 0, by: "default" });
export function setControl(mode, by = "cli") {
  if (!MODES.includes(mode)) throw new Error("mode must be on | pause | off");
  const c = { mode, at: Date.now(), by };
  save("control", c);
  emit("control", c);
  return c;
}
