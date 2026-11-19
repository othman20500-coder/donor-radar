'use strict';
// Evidence-first, deliberately conservative extraction: no dates inferred from ambiguous prose.
const {discoverLinks}=require('./discovery.cjs');
const {sourceUrl}=require('./pure.cjs');
const {readableText}=require('./pure.cjs');
const ENTITY={'amp':'&','nbsp':' ','lt':'<','gt':'>','quot':'"','#39':"'"};
function decode(s){return s.replace(/&([a-z]+|#\d+);/gi,(m,k)=>ENTITY[k.toLowerCase()]??(k[0]==='#'&&+k.slice(1)<=0x10ffff?String.fromCodePoint(+k.slice(1)):m));}
function isoDate(raw){
 const m=/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)$/.exec(raw.trim());if(!m)return null;
 const y=+m[1],mo=+m[2],d=+m[3];if(y<2000||y>2100)return null;
 const dt=new Date(Date.UTC(y,mo-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return null;
 return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function extractDates(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>600000)throw Error('حجم HTML غير مسموح');
 const text=decode(readableText(html)).replace(/[\u200e\u200f]/g,' ').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
 const patterns=[
  {key:'opensAt',re:/(?:تاريخ\s*(?:بدء|فتح)\s*(?:التقديم)?|يبدأ\s*التقديم|فتح\s*التقديم|applications?\s*open(?:s|ing)?|opening\s*date)\s*[:：\-]?\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/gi},
  {key:'closesAt',re:/(?:تاريخ\s*(?:انتهاء|إغلاق|اغلاق)\s*(?:التقديم)?|آخر\s*موعد\s*(?:للتقديم)?|يغلق\s*التقديم|deadline|closing\s*date|applications?\s*close(?:s)?)\s*[:：\-]?\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/gi}
 ];
 const out={opensAt:null,closesAt:null,evidence:[],warnings:[],requiresHumanReview:true};
 for(const {key,re} of patterns){const values=new Set();let match;while((match=re.exec(text))!==null){const d=isoDate(match[1]);if(d){values.add(d);out.evidence.push({field:key,date:d,quote:match[0].slice(0,140)});}else out.warnings.push('تاريخ غير صالح في '+key);}
 if(values.size===1)out[key]=[...values][0];else if(values.size>1)out.warnings.push('تواريخ متعارضة في '+key);
 }
 if(out.opensAt&&out.closesAt&&out.opensAt>out.closesAt){out.warnings.push('تاريخ الفتح بعد الإغلاق');out.opensAt=null;out.closesAt=null;}
 return out;
}
function extractCandidates(html,base){sourceUrl(base);const links=discoverLinks(html,base);return {links,dates:extractDates(html),autoApprove:false};}
module.exports={isoDate,extractDates,extractCandidates};
