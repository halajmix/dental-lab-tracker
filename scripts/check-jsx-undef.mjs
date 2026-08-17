// Guards against the "used a component/icon without importing it" crash
// class (HistoryIcon 2026-07, MapPin + CheckCircle2 2026-08-17): Vite/Rollup
// builds these fine and they only explode at render time, taking the whole
// app to the ErrorBoundary. Runs before every build via the predeploy chain.
// Dependency-free on purpose — the project has no lint tooling.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(name)) files.push(p);
  }
};
walk("src");

let failures = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");

  // Names this file defines or imports (good enough for this codebase's
  // style: named imports, top-level function/const/class declarations,
  // and `X as Y` aliases).
  const defined = new Set(["React", "Fragment"]);
  for (const m of src.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) defined.add(m[1]);
    if (m[2])
      for (const part of m[2].split(","))
        defined.add((part.split(/\s+as\s+/)[1] ?? part).trim());
  }
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:function|class)\s+([A-Z][\w$]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)/g)) defined.add(m[1]);
  // Destructured aliases and params: `{ icon: Icon }`, `icon: Icon,` —
  // renamed bindings anywhere count as definitions.
  for (const m of src.matchAll(/[\w$]+\s*:\s*([A-Z][\w$]*)\s*[,})=]/g)) defined.add(m[1]);

  // Capitalized JSX tags = component references. Member tags (X.Y) only
  // need their root object defined.
  const used = new Set();
  for (const m of src.matchAll(/<([A-Z][\w$]*)(?:\.[\w$]+)*[\s/>]/g)) used.add(m[1]);

  for (const name of used) {
    if (!defined.has(name)) {
      console.error(`${file}: <${name}> is used but never imported or defined`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n${failures} undefined JSX component(s) — this WILL crash at runtime.`);
  process.exit(1);
}
console.log(`check-jsx-undef: ${files.length} files clean`);
