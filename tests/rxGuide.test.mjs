import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchSpokenLab,labFromAlternatives,suggestSpokenLabs,spokenAppointment} from '../src/lib/rxGuide.js';
test('spoken lab full names are exact and ambiguous brands never auto-select',()=>{
 const labs=[{id:'a',name:'Smile World Dental Lab'},{id:'b',name:'Smile World'}];
 assert.equal(matchSpokenLab('Smile world dental lab.',labs)?.id,'a');
 assert.equal(matchSpokenLab('Smile',labs),null);
 assert.equal(matchSpokenLab('Smile World',[...labs,{id:'c',name:'Smile World'}]),null);
});
test('explicit appointment date and 12/24-hour time are normalized',()=>{
 assert.deepEqual(spokenAppointment('2 November 2026 at 10 am'),{date:'2026-11-02',time:'10:00'});
 assert.deepEqual(spokenAppointment('2026-11-02 at 15:30'),{date:'2026-11-02',time:'15:30'});
 assert.equal(spokenAppointment('2nd November 2026 at 12 am').time,'00:00');
 assert.equal(spokenAppointment('2 November 2026 at 12 pm').time,'12:00');
});
test('invalid or ambiguous appointment values are not silently defaulted',()=>{
 assert.deepEqual(spokenAppointment('tomorrow morning'),{date:'',time:''});
 assert.equal(spokenAppointment('11/02/2026 at 3 pm').date,'');
 assert.equal(spokenAppointment('31 February 2026 at 25:30').date,'');
 assert.equal(spokenAppointment('2 November 2026 at 13 pm').time,'');
 assert.equal(spokenAppointment('2 November 2026').time,'');
});

test('common short lab names auto-match only a unique catalog brand',()=>{
 const labs=[{id:'smile',name:'Smile world dental lab'},{id:'art',name:'ART DENTAL LAB'}];
 for(const name of ['Smile World Lab','Smileworld lab','smile, world, lab.','Smile World','Please select Smile World Lab','Smile world laboratory'])assert.equal(matchSpokenLab(name,labs)?.id,'smile',name);
 assert.equal(matchSpokenLab('ART lab',labs)?.id,'art');
 for(const name of ['small world love','not Smile World Lab','Smile World or ART lab','dental lab','world','unknown lab'])assert.equal(matchSpokenLab(name,labs),null,name);
 assert.equal(matchSpokenLab('Smile World Lab',[...labs,{id:'branch',name:'Smile World Dental Lab Muscat'}]),null);
});
test('a known browser alternative can resolve a misheard lab, but conflicting alternatives cannot',()=>{
 const labs=[{id:'smile',name:'Smile world dental lab'},{id:'art',name:'ART DENTAL LAB'}];
 assert.equal(labFromAlternatives([{transcript:'small world love'},{transcript:'Smile World Lab'}],labs).lab?.id,'smile');
 assert.equal(labFromAlternatives([{transcript:'Smile World Lab'},{transcript:'ART Dental Lab'}],labs).ambiguous,true);
 assert.equal(labFromAlternatives([{transcript:'not Smile World Lab'},{transcript:'Smile World Lab'}],labs).lab,null);
 assert.equal(labFromAlternatives([{transcript:'small world love'}],labs).lab,null);
});
test('the reported mishearing is offered for confirmation, never silently routed',()=>{
 const labs=[{id:'smile',name:'Smile world dental lab'},{id:'art',name:'ART DENTAL LAB'}];
 assert.equal(suggestSpokenLabs('small world love',labs)[0]?.id,'smile');
 assert.deepEqual(suggestSpokenLabs('unrelated words',labs),[]);
});
