import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const open=async q=>{await page.goto('http://127.0.0.1:5182/tests/fixtures/sprint1-preview.html?'+q);await page.getByText('Dashboard available').waitFor();await page.waitForFunction(()=>window.calls.length>0);};
 await open('role=doctor');assert.equal(await page.getByRole('region',{name:'Getting started'}).count(),0);
 await open('missing=1');assert.equal(await page.getByRole('region',{name:'Getting started'}).count(),0);
 for(const role of ['doctor','receptionist','admin']) {
  await open('new=1&role='+role+'&user='+role);
  await page.getByRole('region',{name:'Getting started'}).waitFor();
  await page.screenshot({path:'work/sprint1-'+role+'.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Skip',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'Getting started'}).count(),0);
  assert.ok(await page.evaluate(()=>window.calls.includes('sprint1_dismiss_onboarding')));
  await page.reload();await page.getByText('Dashboard available').waitFor();
  assert.equal(await page.getByRole('region',{name:'Getting started'}).count(),0);
 }
 await open('new=1&user=start');await page.getByRole('button',{name:'Start a prescription'}).click();
 await page.getByText('Prescription opened').waitFor();
 await page.setViewportSize({width:1280,height:1000});
 await page.goto('http://127.0.0.1:5182/tests/fixtures/sprint1-preview.html?print=1');
 await page.getByText('Submitted by: Example Receptionist',{exact:true}).waitFor();
 await page.screenshot({path:'work/sprint1-prescription.png'});
 assert.match(await page.evaluate(()=>window.fixturePdf()),/Submitted by: Example Receptionist/);
 await page.goto('http://127.0.0.1:5182/tests/fixtures/sprint1-preview.html?print=1&legacy=1');
 await page.getByText('Dr Legacy Example',{exact:true}).first().waitFor();
 assert.equal(await page.getByText('Submitted by:',{exact:false}).count(),0);
 assert.doesNotMatch(await page.evaluate(()=>window.fixturePdf()),/Submitted by:/);
 assert.deepEqual(errors,[]);
 console.log('PASS: all three role guides, existing user exclusion, missing backend, skip persistence, start action, mobile layout and no browser errors.');
} finally {await browser.close();}
