const esc=(v:unknown)=>String(v??'Not provided').slice(0,1000).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function registrationEmail(kind:string,p:Record<string,unknown>) {
 const title=kind==='setup'?'New user completed setup':'New user registered';
 const fields=kind==='setup'?['email','name','account_type','phone','organization','organization_email','organization_contact','governorate','wilayat','registered_at']:['email','registered_at'];
 return {subject:`Dr-Crown — ${title.toLowerCase()}`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a"><h2 style="color:#1d4ed8">Dr-Crown</h2><h1 style="font-size:24px">${title}</h1><p>${kind==='setup'?'Registration details are ready for your review. No manual activation is required for new organizations.':'An account was created. Clinic or laboratory details will follow when setup is completed.'}</p><table>${fields.map(k=>`<tr><td style="padding:6px 16px 6px 0;color:#64748b">${k.replaceAll('_',' ')}</td><td>${esc(p[k])}</td></tr>`).join('')}<tr><td>Email verified at capture</td><td>${p.email_verified===true?'Yes':'No'}</td></tr></table><p>These details are self-reported. Email verification does not establish professional identity.</p><p><a href="https://dr-crown.com/">Open Dr-Crown to review the account</a></p><p style="font-size:12px;color:#64748b">Use the existing suspension controls if your review identifies a problem.</p></div>`};
}
export function acceptsSecret(actual:string|null,expected:string|undefined){
 if(!actual||!expected?.trim()||actual.length!==expected.length)return false;
 let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
}
