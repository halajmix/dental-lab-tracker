import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectSpeechResults} from '../src/lib/speechResults.js';
const result=(texts,final=true)=>Object.assign(texts.map(transcript=>({transcript,confidence:0.7})),{isFinal:final});
test('re-emitted final results do not duplicate words',()=>{
 const results=[result(['Smile World Lab','small world love'])];
 assert.equal(collectSpeechResults(results).text,'Smile World Lab');
 assert.equal(collectSpeechResults(results).text,'Smile World Lab');
 assert.equal(collectSpeechResults(results).alternatives.length,2);
});
test('partial results never become committed lab text',()=>{
 const r=collectSpeechResults([result(['small world'],false)]);
 assert.equal(r.hasFinal,false);assert.equal(r.text,'');assert.equal(r.interim,'small world');
});
test('treatment dictation retains prior typed content and changed result lists are reconstructed',()=>{
 const first=collectSpeechResults([result(['tooth 21']),result(['zirconia'],false)],'Crown');
 assert.equal(first.text,'Crown tooth 21');
 const next=collectSpeechResults([result(['tooth 21']),result(['monolithic zirconia'])],'Crown');
 assert.equal(next.text,'Crown tooth 21 monolithic zirconia');
});
