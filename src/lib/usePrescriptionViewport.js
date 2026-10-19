import {useEffect,useState} from 'react';

// Follow the visible viewport when a phone keyboard or browser toolbar opens.
export function usePrescriptionViewport(open) {
  const [style,setStyle]=useState({});
  useEffect(()=>{
    if(!open || typeof window==='undefined')return;
    const viewport=window.visualViewport;
    if(!viewport)return;
    const update=()=>setStyle({height:`${viewport.height}px`,top:`${viewport.offsetTop}px`,bottom:'auto'});
    update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
    return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);};
  },[open]);
  return style;
}
