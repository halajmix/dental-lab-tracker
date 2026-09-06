/**
 * PDF proof for the 80mm thermal receipt (src/PrintReceipt.jsx).
 *
 * Renders the REAL <ReceiptSheet> through the REAL RECEIPT_CSS — a copy of
 * either would drift and prove nothing — then prints it with headless Chrome
 * and asserts the geometry the receipt exists to guarantee:
 *
 *   - page width  == 80mm
 *   - page height == content height (NOT a fixed A4/Letter page)
 *   - exactly one page (a blank first/last page is a bug)
 *   - no glyph below 9pt
 *   - no horizontal overflow
 *
 * Chrome's `--print-to-pdf` CLI flag IGNORES `@page { size }` and silently
 * prints US Letter, which would hide the very bug this script exists to
 * catch — so the PDF goes through DevTools Protocol Page.printToPDF with
 * preferCSSPageSize:true instead. Measurements run under emulated print
 * media, so they describe paper, not screen.
 *
 * Usage: node scripts/receipt-proof.mjs   → writes to scripts/.proof/
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, ".proof");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MM_PER_PT = 25.4 / 72;
const MM_PER_PX = 25.4 / 96;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ---- fixtures ---------------------------------------------------------
   Case 1 has the shape of the invoice from the bug report (one implant
   crown, 2 units, 130 OMR). Case 2 is the stress case: 6 items with long
   free text throughout. */
// Fixtures are deliberately FICTIONAL. This file is in a public repository;
// a print fixture built from a real invoice would publish a real patient's
// name alongside a named clinic and dentist. "Health Center" is the one real
// string kept, because billsPatientDirectly() matches on exactly that name.
const LAB = {
  name: "Example Dental Lab",
  address: "Al Khuwair",
  wilayat: "Muscat",
  contact: "00968XXXXXXXX",
  email: "lab@example.com",
};
const CLINIC = { name: "Health Center", dentist: "Dr Test Dentist", contact: "9000XXXX" };
// A normal private clinic, for the default bill-the-clinic path.
const PRIVATE_CLINIC = { name: "Example Dental Clinic", dentist: "Dr Sample Dentist", contact: "9111XXXX" };

// Same case with a lab discount: subtotal 145, discount 15, total 130.
const DISCOUNTED = () => ({
  ...ONE_ITEM, id: "C-DISCOUNT", invoiceNumber: "INV-DISCOUNT", discount: 15,
  billingNote: "Sample invoice note used to exercise the note line.",
});

const ONE_ITEM = {
  id: "C-MT8MGIEBS5",
  invoiceNumber: "INV-MT8MGIEBS5",
  patientName: "Test Patient One",
  patientId: "PT-NEW",
  patientPhone: "9222XXXX",
  appointmentDate: "2026-09-07",
  createdDate: "2026-08-25",
  totalPrice: 130,
  invoiceStatus: "draft",
  labShade: "A3",
  prescription: {
    notation: "FDI",
    included: ["Upper impression", "Lower impression", "Bite registration"],
    notes: "Sample clinical note",
    restorations: [{
      id: "r1", category: "Crown - implant", material: "Zirconia",
      shadeGuide: "Shade by Lab", stumpShade: "N/A",
      implantSystem: "Straumann", abutmentType: "Stock / Straight", abutmentColor: "Yellow",
      teeth: [{ fdi: 24 }, { fdi: 25 }],
    }],
  },
};

const LONG = "Layered feldspathic ceramic over a high-translucency zirconia substructure, cut-back incisal third";
const SIX_ITEMS = {
  ...ONE_ITEM,
  id: "C-STRESS6ITEM",
  invoiceNumber: "INV-STRESS6ITEM",
  patientName: "Test Patient With A Very Long Name Indeed",
  patientId: "PT-2026-000841",
  totalPrice: 1284.5,
  discount: 65.5,          // prints a Discount line; subtotal shows 1,350
  invoiceStatus: "issued",
  prescription: {
    notation: "FDI",
    included: ["Upper impression", "Lower impression", "Bite registration", "Opposing model", "Face-bow record", "Shade photographs"],
    includedOther: "Previous provisional restorations returned for reference",
    notes: "Sample long clinical note used to exercise text wrapping at 72mm: reduce the distal marginal ridge slightly and confirm the occlusal scheme against the face-bow record before glazing.",
    restorations: [
      { id: "a", category: "Crown - implant", material: "Zirconia", shadeGuide: "Shade by Lab", stumpShade: "N/A",
        implantSystem: "Straumann Bone Level Tapered", abutmentType: "Custom / Angulated 15°", abutmentColor: "Yellow",
        teeth: [{ fdi: 24 }, { fdi: 25 }] },
      { id: "b", category: "Bridge - 3 unit", material: LONG, vitaShade: "A3.5", shadeGuide: "VITA Classical",
        stumpShade: "ND3", teeth: [{ fdi: 14 }, { fdi: 15, role: "pontic" }, { fdi: 16 }] },
      { id: "c", category: "Veneer", material: "Lithium disilicate (e.max Press HT)", vitaShade: "BL2",
        shadeGuide: "VITA Bleach", teeth: [{ fdi: 11, role: "veneer" }, { fdi: 12, role: "veneer" }, { fdi: 21, role: "veneer" }, { fdi: 22, role: "veneer" }] },
      { id: "d", category: "Complete denture", material: "Heat-cured PMMA with cross-linked acrylic teeth",
        vitaShade: "A2", shadeGuide: "VITA Classical", arches: "both" },
      { id: "e", category: "Inlay / Onlay", material: "Composite resin (Lava Ultimate)", vitaShade: "A1",
        shadeGuide: "VITA Classical", stumpShade: "ND2", teeth: [{ fdi: 36 }, { fdi: 37 }] },
      { id: "f", category: "Crown - conventional", material: "Porcelain fused to metal, non-precious alloy",
        vitaShade: "C2", shadeGuide: "VITA Classical", stumpShade: "ND4", teeth: [{ fdi: 46 }] },
    ],
  },
};

/* ---- render the real component to static HTML ------------------------- */
// PrescriptionForm reaches the browser (supabase, storage, QR) at import
// time; ReceiptSheet uses only its pure helpers, so those edges are stubbed.
const stub = {
  name: "stub-browser-modules",
  setup(b) {
    b.onResolve({ filter: /(lib\/data\.js|lib\/storageUrl\.jsx|lib\/supabaseClient\.js|ErrorBoundary\.jsx|MobilePhotoQR\.jsx)$/ },
      (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "module.exports = new Proxy({}, { get: () => () => null });", loader: "js",
    }));
  },
};

const entry = `
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ReceiptSheet, RECEIPT_CSS } from ${JSON.stringify(join(HERE, "../src/PrintReceipt.jsx"))};
export function page(fixture, clinic, lab) {
  const body = renderToStaticMarkup(
    React.createElement(ReceiptSheet, { caseObj: fixture, clinic, lab, now: new Date("2026-09-02T18:53:00") })
  );
  // Same DOM shape as production: the receipt lives in a .receipt-portal
  // element that is a direct child of <body>, beside the (here absent) #root.
  return \`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff}
    \${RECEIPT_CSS}
  </style></head><body><div class="receipt-portal">\${body}</div></body></html>\`;
}
`;
const bundle = join(OUT, "render.cjs");
await build({
  stdin: { contents: entry, resolveDir: HERE, loader: "js" },
  bundle: true, platform: "node", format: "cjs", outfile: bundle,
  jsx: "automatic", plugins: [stub], logLevel: "error",
});
const { page } = await import(`file://${bundle}`);

// The page box is measured at print time by the component, so the proof must
// exercise the SAME two exported functions in a real browser rather than
// reimplement them — a reimplementation would pass while the app printed
// Letter. This IIFE puts them on window.__receipt inside the fixture page.
const helpers = await build({
  stdin: {
    contents: `export { pageSizeRule, measurePageMm, calibrationCss, DEFAULT_PAPER_MM, DEFAULT_SIDE_MM } from ${JSON.stringify(join(HERE, "../src/PrintReceipt.jsx"))};`,
    resolveDir: HERE, loader: "js",
  },
  bundle: true, platform: "browser", format: "iife", globalName: "__receipt",
  jsx: "automatic", plugins: [stub], write: false, logLevel: "error",
});
const HELPERS_JS = helpers.outputFiles[0].text;

// Exactly what PrintReceipt does on open: size the box, wait for fonts,
// measure, then declare the page. Same functions, same defaults.
const INJECT = `(async () => {
  const cal = document.createElement('style');
  cal.textContent = __receipt.calibrationCss(__receipt.DEFAULT_PAPER_MM, __receipt.DEFAULT_SIDE_MM);
  document.head.appendChild(cal);
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  const mm = __receipt.measurePageMm(document.querySelector('.receipt'));
  const st = document.createElement('style');
  st.textContent = __receipt.pageSizeRule(__receipt.DEFAULT_PAPER_MM, mm);
  document.head.appendChild(st);
  return { mm, paper: __receipt.DEFAULT_PAPER_MM };
})()`;

/* ---- a minimal DevTools Protocol client ------------------------------- */
const profile = join(tmpdir(), `receipt-proof-${process.pid}`);
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
]);
const wsUrl = await new Promise((res, rej) => {
  let buf = "";
  const t = setTimeout(() => rej(new Error("Chrome did not expose a DevTools port")), 20000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); res(m[1]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  } else if (m.method) listeners.forEach((fn) => fn(m));
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const onceEvent = (method, sessionId) =>
  new Promise((res) => {
    const fn = (m) => {
      if (m.method === method && (!sessionId || m.sessionId === sessionId)) {
        listeners.splice(listeners.indexOf(fn), 1);
        res(m.params);
      }
    };
    listeners.push(fn);
  });

/* ---- measure ---------------------------------------------------------- */
// Chrome writes an uncompressed /MediaBox per page; units are PDF points.
const pageBoxes = (pdfPath) => {
  const raw = readFileSync(pdfPath, "latin1");
  return [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => ({ w: +m[3] - +m[1], h: +m[4] - +m[2] }));
};

const MEASURE = `(() => {
  const root = document.querySelector('.receipt');
  const rootBox = root.getBoundingClientRect();
  const cs = getComputedStyle(root);
  const padR = parseFloat(cs.paddingRight), padL = parseFloat(cs.paddingLeft);
  let minPx = Infinity, minWhere = '', overflow = [];
  for (const el of root.querySelectorAll('*')) {
    const txt = (el.textContent || '').trim();
    const leaf = el.children.length === 0;
    if (leaf && txt) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minPx) { minPx = fs; minWhere = (el.className || el.tagName) + ' :: ' + txt.slice(0, 40); }
    }
    const b = el.getBoundingClientRect();
    if (b.width && (b.right > rootBox.right - padR + 0.5 || b.left < rootBox.left + padL - 0.5)) {
      overflow.push((el.className || el.tagName) + ' :: ' + txt.slice(0, 40));
    }
  }
  return {
    minPt: +(minPx * 0.75).toFixed(2), minWhere,
    overflow: overflow.slice(0, 5), overflowCount: overflow.length,
    contentWidthPx: root.clientWidth, scrollWidthPx: root.scrollWidth,
    docScrollWidthPx: document.documentElement.scrollWidth,
    contentHeightPx: document.documentElement.scrollHeight,
  };
})()`;

let failures = 0;
const fail = (m) => { failures++; console.log(`   FAIL  ${m}`); };
const pass = (m) => console.log(`   ok    ${m}`);
const summary = [];

for (const [name, fixture] of [["one-item", ONE_ITEM], ["six-items", SIX_ITEMS], ["discounted", DISCOUNTED()],
  ["private-clinic", { ...ONE_ITEM, id: "C-PRIVATE", invoiceNumber: "INV-PRIVATE" }]]) {
  const clinicFor = name === "private-clinic" ? PRIVATE_CLINIC : CLINIC;
  const html = join(OUT, `${name}.html`);
  const pdf = join(OUT, `${name}.pdf`);
  const png = join(OUT, `${name}.png`);
  writeFileSync(html, page(fixture, clinicFor, LAB).replace("</body>", `<script>${HELPERS_JS}</script></body>`));

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  const loaded = onceEvent("Page.loadEventFired", sessionId);
  await send("Page.navigate", { url: `file://${html}` }, sessionId);
  await loaded;

  // Everything below describes PAPER, not screen.
  await send("Emulation.setEmulatedMedia", { media: "print" }, sessionId);
  const injected = await send("Runtime.evaluate",
    { expression: INJECT, awaitPromise: true, returnByValue: true }, sessionId);
  const { mm: declaredMm, paper: paperMm } = injected.result.value;
  const { result } = await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true }, sessionId);
  const m = result.value;

  const { data } = await send("Page.printToPDF", {
    preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  }, sessionId);
  writeFileSync(pdf, Buffer.from(data, "base64"));

  // 80mm at 96dpi = 302px.
  await send("Emulation.setDeviceMetricsOverride",
    { width: 302, height: 800, deviceScaleFactor: 2, mobile: false }, sessionId);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
  writeFileSync(png, Buffer.from(shot.data, "base64"));
  await send("Target.closeTarget", { targetId });

  const boxes = pageBoxes(pdf);
  const wmm = boxes[0] ? boxes[0].w * MM_PER_PT : NaN;
  const hmm = boxes[0] ? boxes[0].h * MM_PER_PT : NaN;
  const contentMm = m.contentHeightPx * MM_PER_PX;

  console.log(`\n▸ ${name}`);
  console.log(`   ${boxes.length} page · ${wmm.toFixed(1)}mm × ${hmm.toFixed(1)}mm · content ${contentMm.toFixed(1)}mm · declared ${declaredMm}mm · smallest type ${m.minPt}pt`);

  boxes.length === 1 ? pass("single page, no blank first/last page")
    : fail(`${boxes.length} pages`);
  Math.abs(wmm - paperMm) < 0.6 ? pass(`page width is ${paperMm}mm (the driver's imageable width)`)
    : fail(`page width ${wmm.toFixed(2)}mm, expected ${paperMm}mm`);
  Math.abs(hmm - contentMm) <= 3.5 ? pass(`page height ${hmm.toFixed(1)}mm == content height ${contentMm.toFixed(1)}mm (auto, not fixed)`)
    : fail(`page height ${hmm.toFixed(1)}mm vs content ${contentMm.toFixed(1)}mm — page is not following content`);
  m.minPt >= 9 ? pass(`smallest type ${m.minPt}pt >= 9pt`)
    : fail(`type at ${m.minPt}pt < 9pt — ${m.minWhere}`);
  m.overflowCount === 0 && m.scrollWidthPx <= m.contentWidthPx + 1
    ? pass("no horizontal overflow")
    : fail(`${m.overflowCount} element(s) overflow: ${m.overflow.join(" | ")}`);

  summary.push({ name, pages: boxes.length, widthMm: +wmm.toFixed(2), heightMm: +hmm.toFixed(2),
    contentHeightMm: +contentMm.toFixed(2), declaredMm, smallestPt: m.minPt, overflow: m.overflowCount });
}

writeFileSync(join(OUT, "metrics.json"), JSON.stringify(summary, null, 2));
ws.close(); chrome.kill();
// Chrome may still be flushing its profile; losing a temp dir must never
// fail a passing run.
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
console.log(`proofs in ${OUT}`);
process.exit(failures ? 1 : 0);
