import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../src/PrescriptionForm.jsx", import.meta.url), "utf8");
// Execute the actual form submit handler. Missing live-save dependencies throw
// if sandbox ever falls through to production submission or draft clearing.
const handler = source.split("  const submit = async (opts = {}) => {")[1].split("\n  const err =")[0].trim().replace(/;$/, "");
function context(valid) {
 const events = [];
 return {events, sandbox:true, isValid:valid, submitLock:{current:false},
  errors:{patientName:!valid}, setTouched:v=>events.push(["touched",v]),
  setTestComplete:v=>events.push(["complete",v]), setStep:v=>events.push(["step",v])};
}
test("repeated complete sandbox submissions stop before all production side effects", async () => {
 const ctx=context(true); vm.createContext(ctx);
 for(let i=0;i<3;i++) await vm.runInContext("(async (opts = {}) => {"+handler+")({share:true})",ctx);
 assert.equal(ctx.events.filter(([k,v])=>k==="complete"&&v).length,3);
 assert.equal(ctx.submitLock.current,false);
});
test("incomplete sandbox prescription still uses actual form validation",async()=>{
 const ctx=context(false);vm.createContext(ctx);
 await vm.runInContext("(async (opts = {}) => {"+handler+")()",ctx);
 assert.deepEqual(ctx.events,[["touched",true],["complete",false],["step",1]]);
});
