import { test } from "node:test";
import assert from "node:assert/strict";
import { createBangumiClient } from "../src/bangumi-client.mjs";
import { browser } from "./support/browser.mjs";

test("HTTP errors are rejected rather than reported as an empty page", async () => {
  const dom = browser();
  const client = createBangumiClient({
    subjectType: "anime",
    userId: "test",
    transport: async () => ({ ok: false, status: 403 }),
  });
  await assert.rejects(client.fetchListPage("wish", 1), /HTTP 403/);
  dom.window.close();
});
