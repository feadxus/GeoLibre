import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  registerAssistantGuidance,
  unregisterAssistantToolsByOwner,
} from "../packages/plugins/src/assistant-tool-registry";
import {
  SYSTEM_PROMPT,
  buildSystemPrompt,
} from "../apps/geolibre-desktop/src/lib/assistant/system-prompt";

afterEach(() => unregisterAssistantToolsByOwner("test"));

test("without plugin guidance the host prompt is sent unchanged", () => {
  assert.equal(buildSystemPrompt(), SYSTEM_PROMPT);
  assert.equal(buildSystemPrompt(["  ", ""]), SYSTEM_PROMPT);
});

test("registered guidance is appended after the host prompt, never replacing it", () => {
  registerAssistantGuidance("Call plugin_4_test_get_pm25_ranking directly.", "test");
  registerAssistantGuidance("Never use it as a FROM clause inside run_sql.", "test");
  const prompt = buildSystemPrompt();
  assert.ok(prompt.startsWith(SYSTEM_PROMPT));
  assert.match(prompt, /Plugin guidance:/);
  const first = prompt.indexOf("Call plugin_4_test_get_pm25_ranking directly.");
  const second = prompt.indexOf("Never use it as a FROM clause inside run_sql.");
  assert.ok(first > SYSTEM_PROMPT.length);
  assert.ok(second > first);
  // The host's own rule about run_sql is still present verbatim.
  assert.match(prompt, /For data questions, prefer run_sql/);
  unregisterAssistantToolsByOwner("test");
  assert.equal(buildSystemPrompt(), SYSTEM_PROMPT);
});
