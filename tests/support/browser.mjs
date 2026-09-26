import { JSDOM } from "jsdom";

export function browser() {
  const dom = new JSDOM("", { url: "https://bgm.tv/" });
  globalThis.window = dom.window;
  globalThis.DOMParser = dom.window.DOMParser;
  return dom;
}
