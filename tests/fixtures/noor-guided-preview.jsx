
import React from 'react';
import {createRoot} from 'react-dom/client';
import Form from '/src/PrescriptionForm.jsx';
import '/src/index.css';
// Test-only browser speech adapter. No microphone/audio is accessed.
const speechCase=new URLSearchParams(location.search).get('labSpeech');
const labSpeech={clear:['Smile World Lab'],alternative:['small world love','Smile World Lab'],noisy:['small world love'],ambiguous:['Smile World Lab','ART Dental Lab']};
const voiceAnswers=['Fictional Dental Lab','FDI 21','Crown over implant','Zirconia','Vita Classical A2','Straumann, custom titanium, colour N/A','2 November 2026 at 10 am'];
window.SpeechRecognition=window.webkitSpeechRecognition=class {
 start(){this.onstart?.();const texts=speechCase?labSpeech[speechCase]:[voiceAnswers.shift()||''];const result=texts.map(transcript=>({transcript,confidence:0.7}));result.isFinal=true;queueMicrotask(()=>{this.onresult?.({resultIndex:0,results:[result]});this.onend?.();});}
 stop(){this.onend?.();} abort(){this.onend?.();}
};
const clinic={id:'11111111-1111-4111-8111-111111111111',name:'Fictional Clinic',status:'active',myRole:'doctor'};
const lab={id:'22222222-2222-4222-8222-222222222222',name:speechCase?'Smile world dental lab':'Fictional Dental Lab',status:'active',tat:6};
const api={status:async()=>({visible:true,enabled:true,private_preview:true}),draft:async(text)=>{
 const implant=/implant/i.test(text),complete=!implant||/Straumann/i.test(text);
 return {draft:{notation:'FDI',items:[{category:implant?'Crown - implant':'Crown - tooth',teeth:[{fdi:21,universal:9,role:'unit'}],material:implant?'Zirconia':'Monolithic Zirconia',shadeGuide:'Vita Classical',vitaShade:'A2',stumpShade:'N/A',implantSystem:complete&&implant?'Straumann':'',abutmentType:complete&&implant?'Custom titanium':'',abutmentColor:complete&&implant?'N/A':''}],questions:complete?[]:['Which implant brand, abutment type and colour?'],canApply:complete,notes:'',appointmentDate:null}};
}};
function App(){const[open,setOpen]=React.useState(true);return <><button onClick={()=>setOpen(true)}>Open test</button>{open&&<Form open sandbox defaultClinicId={clinic.id} clinics={new URLSearchParams(location.search).has('layout')?[clinic,{...clinic,id:'44444444-4444-4444-8444-444444444444',name:'Second Fictional Clinic'}]:[clinic]} labs={speechCase?[lab,{...lab,id:'33333333-3333-4333-8333-333333333333',name:'ART Dental Lab'}]:[lab]} noorAssistApi={api} onClose={()=>setOpen(false)}/>}</>};
createRoot(document.getElementById('root')).render(<App/>);
