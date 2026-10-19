// Reconstruct one recognition session instead of appending the same final
// result repeatedly when a browser revises or re-emits its result list.
export function collectSpeechResults(results, base = '') {
  let final='',interim='';
  const alternatives=[];
  for(let i=0;i<results.length;i++){
    const result=results[i];
    if(result.isFinal){
      final+=(result[0]?.transcript||'')+' ';
      for(let j=0;j<result.length;j++)alternatives.push({transcript:result[j].transcript,confidence:result[j].confidence});
    }else interim+=result[0]?.transcript||'';
  }
  return {text:(base+' '+final).trim().slice(0,4000),interim,alternatives,hasFinal:!!final.trim()};
}
