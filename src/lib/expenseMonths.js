export function expenseMonths(expenses) {
  const months=new Map();
  for(const e of expenses){
    const key=e.expenseDate?.slice(0,7)||'Undated';
    if(!months.has(key))months.set(key,{month:key,total:0,categories:{},rows:[]});
    const g=months.get(key),amount=Math.round(Number(e.amount||0)*1000);
    g.total+=amount;g.categories[e.category]=(g.categories[e.category]||0)+amount;g.rows.push(e);
  }
  return [...months.values()].sort((a,b)=>b.month.localeCompare(a.month)).map(g=>({...g,total:g.total/1000,categories:Object.fromEntries(Object.entries(g.categories).map(([k,v])=>[k,v/1000])),rows:g.rows.sort((a,b)=>(b.expenseDate||'').localeCompare(a.expenseDate||''))}));
}
