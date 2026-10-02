// Общая шина событий: мозг и телефон кидают сюда всё, что делают,
// live-сервер раздаёт это сайту в реальном времени (SSE).
import { EventEmitter } from "node:events";
export const bus = new EventEmitter();
bus.setMaxListeners(1000);
export const emit = (type, data = {}) => bus.emit("event", { type, t: Date.now(), ...data });
