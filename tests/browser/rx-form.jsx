import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PrescriptionForm from '../../src/PrescriptionForm.jsx';
import '../../src/index.css';
function Fixture(){
 const [open,setOpen]=useState(!new URLSearchParams(location.search).has('draft'));
 const params=new URLSearchParams(location.search);
 const cases=Array.from({length:35},(_,i)=>({id:`CASE-${String(i+1).padStart(3,'0')}`,patientName:`Fictional Patient ${i+1}`,patientId:`PATIENT-${i+1}`,labId:'lab-a',clinicId:'clinic-a',stageIndex:i%2?4:1,prescription:{category:'Crown - tooth'}}));
 const clinics=[{id:'clinic-a',name:'Fictional Clinic A',myRole:params.get('role')||'admin'},{id:'clinic-b',name:'Fictional Clinic B',myRole:'admin'}];
 return <><button onClick={()=>setOpen(true)}>Open prescription</button><PrescriptionForm open={open} onClose={()=>setOpen(false)} onResume={()=>setOpen(true)} cases={cases} labs={[{id:'lab-a',name:'Fictional Lab',tat:5}]} userId="user-self" authorName="Dr Test" clinics={clinics} defaultClinicId="clinic-a" onSave={async (data)=>{window.saveCalls=(window.saveCalls||0)+1; window.saved=data; await new Promise(r=>{window.finishSave=r;});}} onSubmitFollowup={async()=>{}} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
