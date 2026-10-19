import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validPatientLabel,formatPatientLabel,patientLabelParts} from '../src/lib/patientLabel.js';
test('only an initial and surname pass patient identification validation',()=>{
 for(const name of ['A. Al Harthi',"S. O’Neill",'É. Dupont','م. الحارثي','J. Smith-Jones'])assert.equal(validPatientLabel(name),true,name);
 for(const name of ['Ahmed Al Harthi','Ahmed. Al Harthi','AB. Al Harthi','A.','Al Harthi','A. Patient 123',''])assert.equal(validPatientLabel(name),false,name);
});
test('typed fields produce a compact label without retaining a first name',()=>{
 assert.equal(formatPatientLabel('a',' Al   Harthi '),'A. Al Harthi');
 assert.equal(formatPatientLabel('A.','Al Harthi'),'A. Al Harthi');
 assert.deepEqual(patientLabelParts('A. Al Harthi'),{initial:'A',surname:'Al Harthi'});
});
test('legacy full names are never guessed into initials or surnames',()=>{
 assert.deepEqual(patientLabelParts('Ahmed Ali Al Harthi'),{initial:'',surname:''});
 assert.equal(validPatientLabel(formatPatientLabel('Ahmed','Al Harthi')),false);
});
