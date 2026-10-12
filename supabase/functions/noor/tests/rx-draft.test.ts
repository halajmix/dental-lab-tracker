import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRxDraft} from '../../_shared/rxDraft.ts';
const crown={category:'Crown - tooth',material:'Monolithic Zirconia',shade:'A2',teeth:[{number:26,role:'unit'}]};
test('a complete dictated crown preserves FDI, canonical tooth, material and shade',()=>{
 const d=normalizeRxDraft({notation:'FDI',items:[crown],questions:[],notes:'Keep proximal contacts light.'});
 assert.equal(d.canApply,true);assert.deepEqual(d.items[0].teeth,[{universal:14,fdi:26,role:'unit'}]);assert.equal(d.items[0].shadeGuide,'Vita Classical');assert.equal(d.items[0].vitaShade,'A2');
});
test('missing material/shade and bridge roles block applying rather than defaulting',()=>{
 const d=normalizeRxDraft({notation:'FDI',items:[{category:'Bridge - tooth (conventional)',teeth:[{number:24},{number:25},{number:26}]}]});
 assert.equal(d.canApply,false);assert.equal(d.items[0].material,'');assert.ok(d.questions.some(q=>q.includes('pontic')));assert.ok(d.questions.some(q=>q.includes('shade')));
});
test('Universal notation is converted without treating its tooth numbers as FDI',()=>{
 const d=normalizeRxDraft({notation:'Universal',items:[{...crown,teeth:[{number:26}]}]});
 assert.equal(d.items[0].teeth[0].fdi,42);
});
test('invalid teeth, duplicate teeth, implant omissions and mixed appliances cannot be applied',()=>{
 for(const items of [[{...crown,teeth:[{number:99}]}],[crown,crown],[{...crown,category:'Crown - implant',material:'Zirconia'}],[crown,{category:'Night guard',arches:'upper'}]])assert.equal(normalizeRxDraft({notation:'FDI',items}).canApply,false);
});
test('explicit appliance arch produces extent, while omitted extent remains missing',()=>{
 const d=normalizeRxDraft({notation:'FDI',items:[{category:'Night guard',arches:'upper'}]});assert.equal(d.canApply,true);assert.equal(d.items[0].teeth.length,16);
 assert.equal(normalizeRxDraft({notation:'FDI',items:[{category:'Night guard'}]}).canApply,false);
});
test('identity and price fields cannot flow from AI into the form; invalid dates reject',()=>{
 const d=normalizeRxDraft({notation:'FDI',items:[crown],patientName:'Injected name',price:1,labId:'OTHER'});
 assert.equal('patientName' in d,false);assert.equal('price' in d,false);assert.equal('labId' in d,false);
 assert.throws(()=>normalizeRxDraft({notation:'FDI',items:[crown],appointmentDate:'2026-02-31'}),/Invalid appointment/);
});

test('a bridge requires supporting teeth as well as pontics',()=>{
 const d=normalizeRxDraft({notation:'FDI',items:[{...crown,category:'Bridge - tooth (conventional)',teeth:[{number:25,role:'pontic'}]}]});
 assert.equal(d.canApply,false);assert.ok(d.questions.some(q=>q.includes('supporting abutment')));
});
