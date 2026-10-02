// Выбор транспорта к телефону: adb (по умолчанию) или HTTP API VMOS.
import { CFG } from "../config.js";
export const phone = await import(CFG.phone.transport === "vmos" ? "./vmos-api.js" : "./adb.js");
