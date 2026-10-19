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
 return {events, assistMode:"manual", reviewOpen:false, setReviewOpen:v=>events.push(["review",v]), sandbox:true, isValid:valid, submitLock:{current:false},
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

test("AI prescription must pass a separate human review before the test action",async()=>{
 const ctx=context(true);ctx.assistMode="ai";vm.createContext(ctx);
 await vm.runInContext("(async (opts = {}) => {"+handler+")()",ctx);
 assert.deepEqual(ctx.events,[["touched",true],["review",true]]);
 ctx.events.length=0;ctx.reviewOpen=true;
 await vm.runInContext("(async (opts = {}) => {"+handler+")()",ctx);
 assert.deepEqual(ctx.events,[["touched",true],["complete",true]]);
});

test('sandbox attachment workers stop before storage calls, even when invoked directly',async()=>{
 const main=source.split('export default function PrescriptionForm')[1];
 for(const [name,next] of [['uploadOneScan','addScans'],['uploadOnePhoto','addPhotos']]){
  const body=main.split(`  const ${name} = async (entryId, file) => {`)[1].split(`\n  const ${next}`)[0].trim().replace(/;$/,'');
  // Any fall-through hits undefined storage/upload state and fails the test.
  await vm.runInNewContext('(async (entryId,file) => {'+body+')("fictional",{})',{sandbox:true});
 }
});
