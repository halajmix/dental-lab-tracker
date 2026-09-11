import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolDefinitions, WRITE_TOOLS } from "../tools/index.ts";

test("12 tools, every schema self-contained (no $ref), strict-compatible", () => {
  const defs = toolDefinitions();
  assert.equal(defs.length, 12);
  for (const d of defs) {
    const s = JSON.stringify(d.input_schema);
    assert.doesNotMatch(s, /\$ref/, `${d.name} still has a $ref`);
    assert.equal((d.input_schema as { additionalProperties?: boolean }).additionalProperties, false, `${d.name} must forbid extra properties`);
    assert.ok(Array.isArray((d.input_schema as { required?: string[] }).required), `${d.name} must declare required`);
  }
});
test("the committed schema copy equals the design document", () => {
  const a = JSON.parse(readFileSync(new URL("../tools/schemas.json", import.meta.url), "utf8"));
  const b = JSON.parse(readFileSync(new URL("../../../../docs/agents/noor/03-tools.json", import.meta.url), "utf8"));
  assert.deepEqual(a, b);
});
test("write tools are exactly the six the design allows", () => {
  assert.deepEqual([...WRITE_TOOLS].sort(), ["add_case_note", "escalate_to_human", "flag_case_risk", "record_remake_reason", "request_clarification", "send_status_update"]);
});
