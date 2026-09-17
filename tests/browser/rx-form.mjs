// Run: npm run test:rx-browser (install engines once: npx playwright install chromium webkit).
// All clinical/API interactions use fictional intercepted responses.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:54399';
process.env.VITE_SUPABASE_ANON_KEY = 'fictional-test-key';
const server = await createServer({ server: {host:'127.0.0.1', port:0, open:false} });
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const self = {id:'dentist-self',user_id:'user-self',name:'Dr Test'};
const other = {id:'dentist-other',user_id:'user-other',name:'Dr Other'};
const draft = {patientName:'Fictional Patient',labId:'lab-a',selectedClinicId:'clinic-a',insertionDate:'2030-01-10',caseMode:'restorations',restorations:[{id:'restoration-a',category:'Crown - tooth',material:'Zirconia',teeth:[8],shadeGuide:'Vita Classical',vitaShade:'A2'}]};
let browser;
try {
for (const engineName of (process.env.RX_BROWSERS || 'chromium').split(',')) {
 browser = await ({chromium,webkit}[engineName]).launch();
 async function setup({viewport={width:1041,height:631},role='admin',roster=[self],savedDraft=null,failRoster=false,draftAction='resume',failDeleteOnce=false}={}) {
  const page=await browser.newPage({viewport});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const drafts=[];let deletes=0;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin)return route.continue();
   assert.equal(url.origin,'http://127.0.0.1:54399','Never contact production');
   if(url.pathname.includes('clinic_dentists')) {
    if(failRoster)return route.fulfill({status:500,json:{message:'Fictional roster failure'}});
    return route.fulfill({json:url.searchParams.get('clinic_id')==='eq.clinic-b'?[other]:roster});
   }
   if(url.pathname.includes('rx_drafts') && route.request().method()==='DELETE') {
    deletes++;
    if(failDeleteOnce && deletes===1)return route.fulfill({status:500,json:{message:'Fictional deletion failure'}});
    savedDraft=null;return route.fulfill({status:204});
   }
   if(url.pathname.includes('save_rx_draft'))drafts.push(route.request().postDataJSON());
   return route.fulfill({json:url.pathname.includes('rx_drafts') ? (savedDraft?{payload:savedDraft}:null):null});
  });
  await page.goto(`${origin}/tests/browser/rx-form.html?role=${role}${savedDraft?'&draft=1':''}`);
  if(savedDraft){await page.getByText('Resume',{exact:true}).waitFor();await page.getByRole('button',{name:'Open prescription',exact:true}).click();
   await page.getByRole('dialog',{name:'Unfinished prescription found'}).waitFor();
   if(draftAction==='resume')await page.getByRole('button',{name:'Resume saved draft',exact:true}).click();
  }
  if(draftAction==='resume')await page.getByRole('dialog',{name:'Digital Laboratory Prescription'}).waitFor();
  await page.waitForTimeout(150);
  return {page,errors,drafts,deleteCount:()=>deletes};
 }
 for(const viewport of [{width:1041,height:631},{width:1440,height:900},{width:390,height:844},{width:320,height:568}]) {
  const {page,errors}=await setup({viewport});
  assert.equal(await page.locator('#treating-dentist').count(),0);
  assert.equal(await page.getByRole('button',{name:'Add a Dentist',exact:true}).count(),0);
  assert.equal(await page.getByText('Dr Test',{exact:true}).count(),1);
  const scroller=page.locator('[data-rx-scroll]');
  const box=await scroller.boundingBox(); assert.ok(box.height>60, 'Usable scroll area');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,1500);await page.waitForTimeout(250);
  const dimensions=await scroller.evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}));
  if(dimensions.total>dimensions.height)assert.ok(dimensions.top>0,'Wheel must scroll the form');
  assert.equal(await page.evaluate(()=>window.scrollY),0,'Background stays still');
  assert.ok(await page.getByRole('button',{name:'Next · Treatment',exact:true}).isVisible());
  const footer=await page.getByRole('button',{name:'Submit Prescription',exact:true}).boundingBox();
  assert.ok(footer.y>=0 && footer.y+footer.height<=viewport.height,'Submit remains on screen');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Close & keep draft',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
  await page.mouse.move(20,viewport.height/2);await page.mouse.wheel(0,300);await page.waitForTimeout(150);
  assert.ok(await page.evaluate(()=>window.scrollY>0),'Page scroll restored after close');
  await page.getByRole('button',{name:'Open prescription',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  assert.deepEqual(errors,[]);await page.close();
  console.log(`PASS ${engineName} scroll/identity/close/reopen ${viewport.width}×${viewport.height}`);
 }
 for(const config of [{role:'admin',roster:[self,other]},{role:'receptionist',roster:[other]},{role:'admin',roster:[]},{role:'admin',roster:[{...other,user_id:null}]}]) {
  const {page,errors}=await setup(config);
  assert.ok(await page.locator('#treating-dentist').isVisible());
  assert.equal(await page.locator('#treating-dentist').inputValue(),'');
  assert.ok(await page.getByRole('button',{name:'Add a Dentist',exact:true}).isVisible());
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(`PASS ${engineName} team/receptionist/empty/invited roster retains explicit choice`);
 {
  const {page,errors}=await setup();
  await page.locator('select').first().selectOption('clinic-b');
  await page.locator('#treating-dentist').waitFor();
  assert.equal(await page.locator('#treating-dentist').inputValue(),'');
  await page.locator('select').first().selectOption('clinic-a');
  await page.getByText('Dr Test',{exact:true}).waitFor();
  assert.equal(await page.locator('#treating-dentist').count(),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 {
  const {page}=await setup({failRoster:true});
  await page.getByText("Couldn't load the clinic's dentists. Please try again.",{exact:false}).waitFor();
  assert.equal(await page.locator('#treating-dentist').inputValue(),'');
  await page.close();
 }
 console.log(`PASS ${engineName} clinic switch and failed roster never assume another dentist`);
 {
  const {page,errors}=await setup({savedDraft:draft});
  await page.getByRole('button',{name:'Next · Treatment',exact:true}).click();
  await page.getByRole('button',{name:'Next · Appointment & files',exact:true}).click();
  assert.equal(await page.locator('input[type=date]').inputValue(),'2030-01-10');
  await page.getByRole('button',{name:'Submit Prescription',exact:true}).click();
  await page.waitForFunction(()=>window.saved);
  assert.equal(await page.locator('fieldset').evaluate(e=>e.disabled),true);
  assert.equal(await page.getByRole('button',{name:'Close & keep draft',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.saved.treatingDentistId),'dentist-self');
  assert.equal(await page.evaluate(()=>window.saved.treatingDentistName),'Dr Test');
  assert.equal(await page.evaluate(()=>window.saveCalls),1);
  await page.evaluate(()=>window.finishSave());
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(`PASS ${engineName} restored draft reaches all steps, submits self identity, locks controls, and closes`);
 for(const viewport of [{width:1041,height:631},{width:390,height:844}]) {
  const {page,errors}=await setup({viewport});
  await page.getByRole('button',{name:'Follow-up existing case',exact:true}).click();
  const list=page.getByLabel('Cases available for follow-up');
  assert.equal(await list.getByRole('button').count(),35,'All cases, not just eight');
  await page.getByText('All 35 cases · active and completed',{exact:true}).waitFor();
  const search=page.getByPlaceholder('Search all cases — patient, ID, case #, lab (incl. completed)');
  await search.fill('Fictional');
  assert.equal(await list.getByRole('button').count(),35,'Search is not capped at twenty');
  await search.fill('CASE-034');
  assert.equal(await list.getByRole('button').count(),1);
  await list.getByRole('button').click();
  await page.getByText('Patient ID PATIENT-34 · Work complete',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Change',exact:true}).click();
  assert.equal(await list.getByRole('button').count(),35);
  const box=await list.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,5000);await page.waitForTimeout(200);
  assert.ok(await list.evaluate(e=>e.scrollTop>0),'Case list scrolls to older cases');
  assert.equal(await page.evaluate(()=>window.scrollY),0);
  await list.getByRole('button',{name:/CASE-035/}).click();
  await page.getByText('Patient ID PATIENT-35 · In progress',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Change',exact:true}).click();
  await search.fill('no-such-case');
  await page.getByText('No matching cases.',{exact:true}).waitFor();
  await search.fill('');
  assert.equal(await list.getByRole('button').count(),35);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(`PASS ${engineName} all 35 follow-up cases browse/search/select, including older completed cases`);
 {
  const {page,errors,deleteCount}=await setup({savedDraft:{...draft,patientName:'5'},draftAction:'choose',failDeleteOnce:true});
  assert.equal(await page.getByPlaceholder('Full name',{exact:true}).count(),0,'No silently restored patient field');
  assert.ok(await page.getByText('Saved patient name:',{exact:false}).isVisible());
  await page.getByRole('button',{name:'Discard draft & start blank',exact:true}).click();
  await page.getByRole('alert').filter({hasText:"Couldn't discard"}).waitFor();
  assert.equal(await page.getByPlaceholder('Full name',{exact:true}).count(),0,'Failed delete preserves the draft choice');
  await page.getByRole('button',{name:'Resume saved draft',exact:true}).click();
  assert.equal(await page.getByPlaceholder('Full name',{exact:true}).inputValue(),'5','Explicit resume preserves original value');
  await page.getByRole('button',{name:'Close & keep draft',exact:true}).click();
  await page.getByRole('button',{name:'Open prescription',exact:true}).click();
  await page.getByRole('dialog',{name:'Unfinished prescription found'}).waitFor();
  await page.getByRole('button',{name:'Discard draft & start blank',exact:true}).click();
  await page.getByRole('dialog',{name:'Digital Laboratory Prescription'}).waitFor();
  assert.equal(await page.getByPlaceholder('Full name',{exact:true}).inputValue(),'');
  assert.equal(deleteCount(),2);
  await page.getByRole('button',{name:'Close & keep draft',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Open prescription',exact:true}).click();
  await page.getByRole('dialog',{name:'Digital Laboratory Prescription'}).waitFor();
  assert.equal(await page.getByPlaceholder('Full name',{exact:true}).inputValue(),'','Discarded name stays gone after reload');
  await page.getByPlaceholder('Full name',{exact:true}).fill('Fresh Patient');
  await page.getByRole('button',{name:'Close & keep draft',exact:true}).click();
  await page.getByRole('button',{name:/Unfinished Rx.*Resume/}).click();
  assert.equal(await page.getByPlaceholder('Full name',{exact:true}).inputValue(),'Fresh Patient','Resume shortcut retains work');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(`PASS ${engineName} saved name 5 requires explicit resume; failed discard preserves work; successful discard starts blank`);
 await browser.close(); browser=null;
}
}finally{await browser?.close();await server.close();}
