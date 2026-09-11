// The design docs are the source of truth; the runtime carries copies. Fail
// loudly when they drift. Run in CI and before deploying `noor`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const docs = JSON.parse(readFileSync(join(root, "docs/agents/noor/03-tools.json"), "utf8"));
const rt = JSON.parse(readFileSync(join(root, "supabase/functions/noor/tools/schemas.json"), "utf8"));
if (JSON.stringify(docs) !== JSON.stringify(rt)) { console.log("✗ tools/schemas.json differs from docs/agents/noor/03-tools.json"); bad++; } else console.log("✓ tool schemas match the design");
const md = readFileSync(join(root, "docs/agents/noor/01-system-prompt.md"), "utf8");
const block = md.split("```")[1].trim();
const ts = readFileSync(join(root, "supabase/functions/noor/lib/prompt.ts"), "utf8");
// The template contains escaped backticks (\`issues\`), so "first `;" is not the end:
// match the whole literal, treating \` as content, then unescape.
const m = /SYSTEM_PROMPT_TEMPLATE = `((?:\\`|[^`])*)`;/s.exec(ts);
if (!m) { console.log("✗ could not locate SYSTEM_PROMPT_TEMPLATE in lib/prompt.ts"); process.exit(1); }
const tpl = m[1].replace(/\\`/g, "`").trim();
const norm = (s) => s.replace(/\r/g, "").replace(/[ \t]+$/gm, "");
if (norm(block) !== norm(tpl)) { console.log("✗ lib/prompt.ts differs from 01-system-prompt.md"); bad++; } else console.log("✓ system prompt matches the design");
process.exit(bad ? 1 : 0);
