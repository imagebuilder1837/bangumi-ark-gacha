export function createBrowserAdapter() {
  return {
    origin: window.location.origin,
    parse: (html) => new DOMParser().parseFromString(html, "text/html"),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}
