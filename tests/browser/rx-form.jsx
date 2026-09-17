import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PrescriptionForm from '../../src/PrescriptionForm.jsx';
import '../../src/index.css';
function Fixture(){
 const [open,setOpen]=useState(!new URLSearchParams(location.search).has('draft'));
 const params=new URLSearchParams(location.search);
 const clinics=[{id:'clinic-a',name:'Fictional Clinic A',myRole:params.get('role')||'admin'},{id:'clinic-b',name:'Fictional Clinic B',myRole:'admin'}];
 return <><button onClick={()=>setOpen(true)}>Open prescription</button><PrescriptionForm open={open} onClose={()=>setOpen(false)} onResume={()=>setOpen(true)} labs={[{id:'lab-a',name:'Fictional Lab',tat:5}]} userId="user-self" authorName="Dr Test" clinics={clinics} defaultClinicId="clinic-a" onSave={async (data)=>{window.saveCalls=(window.saveCalls||0)+1; window.saved=data; await new Promise(r=>{window.finishSave=r;});}} onSubmitFollowup={async()=>{}} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
