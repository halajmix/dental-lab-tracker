// Undefined-identifier gate for the client. A free variable in JSX is a
// runtime ReferenceError that Vite never sees — it shipped once as
// "noorFlagsByCase is not defined" and blanked the dentist dashboard.
// TypeScript's checker over the .jsx files reports exactly that class of
// mistake as "Cannot find name". Runs inside deploy.sh.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const files = readdirSync("src").filter((f) => f.endsWith(".jsx")).map((f) => `src/${f}`);
let out = "";
try {
  execFileSync("npx", ["--yes", "-p", "typescript@5", "tsc", "--noEmit", "--allowJs", "--checkJs", "--jsx", "preserve", "--target", "esnext", "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck", ...files], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) { out = (e.stdout ?? "") + (e.stderr ?? ""); }
const hits = [...new Set(out.split("\n").filter((l) => /error TS2304: Cannot find name/.test(l)).map((l) => l.replace(/\((\d+),\d+\)/, ":$1")))];
if (hits.length) { console.error("check-undef: undefined identifiers\n  " + hits.join("\n  ")); process.exit(1); }
console.log(`check-undef: ${files.length} files clean`);
