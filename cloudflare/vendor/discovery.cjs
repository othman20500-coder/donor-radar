'use strict';
// Conservative candidate discovery: no dates guessed, no automatic approval.
const {sourceUrl}=require('./pure.cjs');
const GRANT=/(منح(?:ة|)|تمويل|دعم المشاريع|التقديم|grant|funding|apply)/i;
const MAX_CANDIDATES=30;
function entities(s){return s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function plain(s){return entities(String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());}
function discoverLinks(html,base){
 const baseUrl=sourceUrl(base);if(typeof html!=='string'||Buffer.byteLength(html)>600000)throw Error('Invalid source document');
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 const found=new Map();const re=/<a\b([^>]*?)>([\s\S]*?)<\/a\s*>/gi;let m;
 while((m=re.exec(html))!==null){const href=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1]);if(!href)continue;
 const title=plain(m[2]).slice(0,250);if(title.length<5||!GRANT.test(title))continue;
 let u;try{u=new URL(entities(href[1]??href[2]),baseUrl);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);u=sourceUrl(u.toString());}catch{continue;}
 if(new URL(u).origin!==new URL(baseUrl).origin)continue;
 if(!found.has(u))found.set(u,{title,sourceUrl:u,opensAt:null,closesAt:null,verifiedOpen:false,confirmedClosed:false,confidence:'candidate_only',evidence:'linked_title',needsHumanReview:true});
 if(found.size>=MAX_CANDIDATES)break;
 }
 return [...found.values()];
}
function stageCandidates(m,sourceId,html){
 const row=m.db.prepare('SELECT url FROM sources WHERE id=?').get(sourceId);if(!row)throw Error('Unknown source');
 const candidates=discoverLinks(html,row.url),ids=[];
 for(const c of candidates){ids.push(m.propose({sourceId,title:c.title,sourceUrl:c.sourceUrl}));}
 return {sourceId,candidates:candidates.length,ids,requiresApproval:true};
}
const STOP=new Set(['منحه','منح','برنامج','دعم','تمويل','اعلان','التقديم','في','من','علي','الي','على','الى','the','for','and','of','grant','grants','funding','apply','program','programme','fund']);
function titleKey(t){const words=String(t).normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[0-9٠-٩]+/g,' ').replace(/[^\p{L}\s]/gu,' ').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w));return (words.length?words:[String(t).trim().toLowerCase()]).sort().join(' ').slice(0,300);}
function canonicalLink(href,base){const baseUrl=sourceUrl(base);let u=new URL(entities(String(href)),baseUrl);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(k))u.searchParams.delete(k);u=sourceUrl(u.toString());if(new URL(u).origin!==new URL(baseUrl).origin)throw Error('رابط من نطاق آخر');return u;}
/** True for listing/service pages ("منتجات المنح", "تقويم المنح", the source page itself). A label for reviewers, never a filter. */
function indexLike(title,url,base){const t=String(title||'').trim();if(/^(منتجات|تقويم|خدمات|الخدمات|قائمة|جميع|دليل|كل|all|list|products|services|calendar|catalog)(?=\s|$)/i.test(t))return true;try{return base?new URL(url).href===new URL(base).href:false;}catch{return false;}}
module.exports={discoverLinks,stageCandidates,titleKey,canonicalLink,GRANT,indexLike};
