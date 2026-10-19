import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchSpokenLab,spokenAppointment} from '../src/lib/rxGuide.js';
test('spoken lab requires one exact normalized match, never fuzzy guesses',()=>{
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
