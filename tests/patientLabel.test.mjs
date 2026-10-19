import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validPatientLabel} from '../src/lib/patientLabel.js';
test('dentists can enter any nonempty name or patient reference',()=>{
 for(const value of ['A. Al Harthi','Ahmed Al Harthi','AB. Al Harthi','A','Al Harthi','Patient 123','PT-7K9Q2M','مريم الحارثي',"O’Neill",'张三','  any entry  '])assert.equal(validPatientLabel(value),true,value);
});
test('only blank or absent patient identification is rejected',()=>{
 for(const value of ['', ' ', '\n\t',null,undefined])assert.equal(validPatientLabel(value),false);
});
