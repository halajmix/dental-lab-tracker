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

import {normalizeSpokenToothNames,spokenToothReferences,enforceRxToothReferences} from '../../_shared/rxToothNames.ts';
test('permanent quadrant names map consistently and numeric FDI stays unchanged',()=>{
 assert.equal(normalizeSpokenToothNames('tooth 21, tooth 23, tooth 24; upper right 4, upper left three, LL6, lr7'),'tooth 21, tooth 23, tooth 24; FDI tooth 14, FDI tooth 23, FDI tooth 36, FDI tooth 47');
 assert.equal(normalizeSpokenToothNames('upper right 9, UR12, upper left D, left 4'),'upper right 9, UR12, upper left D, left 4');
 for(const [q,base] of [['UR',10],['UL',20],['LL',30],['LR',40]])for(let p=1;p<=8;p++)assert.equal(normalizeSpokenToothNames(q+p),'FDI tooth '+(base+p));
});
test('implant brand, supported abutment and explicit colour are required independently',()=>{
 const full={...crown,category:'Crown - implant',material:'Zirconia',implantSystem:'Straumann',abutmentType:'Ti-Base',abutmentColor:'Yellow'};
 assert.equal(normalizeRxDraft({notation:'FDI',items:[full]}).canApply,true);
 for(const field of ['implantSystem','abutmentType','abutmentColor']){
  const d=normalizeRxDraft({notation:'FDI',items:[{...full,[field]:''}]});assert.equal(d.canApply,false);assert.ok(d.questions.length>0);
 }
 assert.equal(normalizeRxDraft({notation:'FDI',items:[{...full,abutmentColor:'N/A'}]}).canApply,true);
 assert.equal(normalizeRxDraft({notation:'FDI',items:[{...full,abutmentType:'Invented component'}]}).canApply,false);
 assert.equal(normalizeRxDraft({notation:'FDI',items:[{...full,implantSystem:'Other — see notes'}]}).canApply,false);
});

test('ambiguous quadrants and incorrect model conversions cannot be applied',()=>{
 assert.deepEqual(spokenToothReferences('upper right 4 and upper left 3','Universal'),[{fdi:14,universal:5,outputNumber:5},{fdi:23,universal:11,outputNumber:11}]);
 const d=normalizeRxDraft({notation:'Universal',items:[{...crown,teeth:[{number:5},{number:10}]}]});assert.equal(enforceRxToothReferences(d,'upper right 4 and upper left 3').canApply,false);
 const complete=normalizeRxDraft({notation:'Universal',items:[{...crown,teeth:[{number:5},{number:11}]}]});assert.equal(enforceRxToothReferences(complete,'upper right 4 and upper left 3').canApply,true);
 for(const text of ['left 4','right four','upper 3','UR9','upper left D'])assert.equal(enforceRxToothReferences(normalizeRxDraft({notation:'FDI',items:[crown]}),text).canApply,false);
});

test('explicit and bare tooth references are checked in their original notation',()=>{
 assert.deepEqual(spokenToothReferences('tooth 21, tooth 23, tooth 24','FDI').map(t=>t.fdi),[21,23,24]);
 assert.deepEqual(spokenToothReferences('tooth 26','Universal').map(t=>t.fdi),[42]);
 const d=normalizeRxDraft({notation:'FDI',items:[crown]});
 assert.equal(enforceRxToothReferences(d,'tooth 21','FDI').canApply,false);
 assert.equal(enforceRxToothReferences(d,'FDI 99','FDI').canApply,false);
 assert.equal(enforceRxToothReferences(d,'tooth 99','FDI').canApply,false);
 assert.equal(enforceRxToothReferences(d,'tooth 26','FDI').canApply,true);
});
