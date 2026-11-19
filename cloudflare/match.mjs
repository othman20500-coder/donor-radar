// Structured, explainable matching. Nothing here decides eligibility: every criterion is
// 'met', 'unmet' or 'unknown', and the verdict is never stronger than 'candidate_ok'.
export const ENTITY_TYPES={association:'جمعية أهلية',foundation:'مؤسسة أهلية',nonprofit_company:'شركة غير ربحية',government:'جهة حكومية',any:'أي جهة غير ربحية'};
export const AUDIENCES={youth:'الشباب',children:'الأطفال',women:'النساء',elderly:'كبار السن',disabled:'ذوو الإعاقة',families:'الأسر',volunteers:'المتطوعون',general:'عامة المجتمع'};
export const APP_STATUS={open:'التقديم مفتوح',upcoming:'قادم',closed:'مغلق',rolling:'مستمر',unknown:'غير معروف'};
// Document ids follow the dashboard's document register (DOCS).
export const READINESS={license:'شهادة الترخيص',fs1:'قوائم مالية معتمدة',board:'قرار مجلس الإدارة',iban:'شهادة الآيبان',budget_cur:'موازنة معتمدة للعام الحالي',profile:'ملف تعريفي',authorized:'مفوض مسجّل'};
export const DEFAULT_ORG={type:'association',region:'الرياض'};
const AUD_WORDS={youth:/شباب|شاب|يافع|youth/i,children:/طفل|أطفال|اطفال|طفولة|children|child/i,women:/نساء|سيدات|امرأة|المرأة|أسر منتجة|women/i,elderly:/كبار السن|مسن|elderly/i,disabled:/إعاقة|اعاقة|ذوي الإعاقة|disab/i,families:/أسر|اسر|عائل|family|families/i,volunteers:/متطوع|تطوع|volunteer/i};
const emptyTerms=()=>({entityTypes:[],region:{scope:'unknown',names:[]},audiences:[],amount:{min:null,max:null},durationMonths:{min:null,max:null},applicationStatus:'unknown',readiness:[],evidence:{}});
const isNum=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
function list(v,allowed,label,limit=10){if(v===undefined)return [];if(!Array.isArray(v)||v.length>limit||new Set(v).size!==v.length||v.some(x=>typeof x!=='string'||!Object.hasOwn(allowed,x)))throw new RangeError(label);return v;}
/** Validates and normalises reviewer-entered terms. Throws RangeError with an Arabic message. */
export function validateTerms(input){
 const t=emptyTerms();if(input===undefined||input===null)return t;if(typeof input!=='object'||Array.isArray(input))throw new RangeError('شروط غير صالحة.');
 const allowed=['entityTypes','region','audiences','amount','durationMonths','applicationStatus','readiness','evidence'];if(Object.keys(input).some(k=>!allowed.includes(k)))throw new RangeError('حقل شروط غير مسموح.');
 t.entityTypes=list(input.entityTypes,ENTITY_TYPES,'نوع الجهة المؤهلة غير صالح.');t.audiences=list(input.audiences,AUDIENCES,'فئة مستهدفة غير صالحة.');t.readiness=list(input.readiness,READINESS,'متطلب جاهزية غير صالح.');
 if(input.region!==undefined){const r=input.region;if(!r||typeof r!=='object'||!['national','regional','unknown'].includes(r.scope)||!Array.isArray(r.names||[])||(r.names||[]).length>20||(r.names||[]).some(n=>typeof n!=='string'||!n.trim()||n.length>80))throw new RangeError('نطاق جغرافي غير صالح.');t.region={scope:r.scope,names:(r.names||[]).map(n=>n.trim())};}
 for(const [k,max] of [['amount',1e12],['durationMonths',600]]){const r=input[k];if(r===undefined)continue;if(!r||typeof r!=='object'||Object.keys(r).some(x=>!['min','max'].includes(x)))throw new RangeError('نطاق رقمي غير صالح.');for(const x of ['min','max'])if(r[x]!==null&&r[x]!==undefined&&(!isNum(r[x])||r[x]>max))throw new RangeError('قيمة رقمية غير صالحة.');if(isNum(r.min)&&isNum(r.max)&&r.min>r.max)throw new RangeError('الحد الأدنى أكبر من الأعلى.');t[k]={min:r.min??null,max:r.max??null};}
 if(input.applicationStatus!==undefined){if(!Object.hasOwn(APP_STATUS,input.applicationStatus))throw new RangeError('حالة تقديم غير صالحة.');t.applicationStatus=input.applicationStatus;}
 if(input.evidence!==undefined){const e=input.evidence;if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).length>12)throw new RangeError('أدلة الشروط غير صالحة.');for(const [k,v] of Object.entries(e)){if(!allowed.includes(k)||k==='evidence'||typeof v!=='string'||v.length>400)throw new RangeError('دليل شرط غير صالح.');t.evidence[k]=v.trim();}}
 return t;
}
export function parseTerms(json){try{return validateTerms(JSON.parse(json||'{}'));}catch{return emptyTerms();}}
/** Conservative reading of free-text project fields. Returns null when the text is not clear. */
export function monthsFrom(text){if(typeof text!=='string')return null;const s=text.replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c));if(/سنتين|عامين/.test(s))return 24;let m=/(\d{1,3})\s*(?:شهر|أشهر|اشهر|months?)/i.exec(s);if(m)return +m[1];m=/(\d{1,2})\s*(?:سنة|سنوات|عام|أعوام|years?)/i.exec(s);if(m)return +m[1]*12;if(/\b(?:سنة|عام)\b/.test(s))return 12;return null;}
export function audiencesFrom(text){if(typeof text!=='string')return [];return Object.entries(AUD_WORDS).filter(([,re])=>re.test(text)).map(([k])=>k);}
export function statusFor(terms,o,today){
 if(o.closes_at&&o.closes_at<today)return 'closed';
 if(o.opens_at&&o.opens_at>today)return 'upcoming';
 if(terms.applicationStatus!=='unknown')return terms.applicationStatus;
 if(o.closes_at)return 'open';
 return 'unknown';
}
const row=(key,label,status,detail)=>({key,label,status,detail});
/** Compare one approved opportunity with one project. `docs` maps document id -> state string. */
export function matchProject(o,p,{terms=parseTerms(o.terms_json),topics=[],org=DEFAULT_ORG,docs={},today=new Date().toISOString().slice(0,10),labels={}}={}){
 const tags=Array.isArray(p.tags)?p.tags:[],common=topics.filter(t=>tags.includes(t)),criteria=[],name=t=>labels[t]||t;
 criteria.push(topics.length?row('topics','المجالات',common.length?'met':'unmet',common.length?'مشتركة: '+common.map(name).join('، '):'لا توجد مجالات مشتركة'):row('topics','المجالات','unknown','مجالات الفرصة غير موثقة'));
 criteria.push(terms.entityTypes.length?(terms.entityTypes.includes(org.type)||terms.entityTypes.includes('any')?row('entity','نوع الجهة','met','الجهة المؤهلة: '+terms.entityTypes.map(x=>ENTITY_TYPES[x]).join('، ')):row('entity','نوع الجهة','unmet','الجهة المؤهلة: '+terms.entityTypes.map(x=>ENTITY_TYPES[x]).join('، '))):row('entity','نوع الجهة','unknown','نوع الجهة المؤهلة غير موثق'));
 const reg=terms.region;criteria.push(reg.scope==='national'?row('region','النطاق الجغرافي','met','على مستوى المملكة'):reg.scope==='regional'&&reg.names.length?(reg.names.some(n=>n.includes(org.region)||org.region.includes(n))?row('region','النطاق الجغرافي','met','يشمل '+org.region):row('region','النطاق الجغرافي','unmet','مقصور على: '+reg.names.join('، '))):row('region','النطاق الجغرافي','unknown','النطاق غير موثق'));
 const want=terms.audiences,have=audiencesFrom(`${p.audience||''} ${p.name||''}`),aud=have.filter(a=>want.includes(a));
 criteria.push(!want.length?row('audience','الفئة المستهدفة','unknown','فئة الفرصة غير موثقة'):!have.length?row('audience','الفئة المستهدفة','unknown','تعذر تحديد فئة المشروع'):aud.length?row('audience','الفئة المستهدفة','met','مشتركة: '+aud.map(a=>AUDIENCES[a]).join('، ')):row('audience','الفئة المستهدفة','unmet','فئة المشروع: '+have.map(a=>AUDIENCES[a]).join('، ')));
 const {min,max}=terms.amount;criteria.push(min===null&&max===null?row('amount','المبلغ','unknown','حدود المبلغ غير موثقة'):typeof p.amount!=='number'?row('amount','المبلغ','unknown','مبلغ المشروع غير محدد'):max!==null&&p.amount>max?row('amount','المبلغ','unmet','ميزانية المشروع '+p.amount+' تتجاوز الحد '+max):min!==null&&p.amount<min?row('amount','المبلغ','unmet','ميزانية المشروع '+p.amount+' دون الحد '+min):row('amount','المبلغ','met','ضمن الحدود الموثقة'));
 const dm=monthsFrom(p.duration),dr=terms.durationMonths;criteria.push(dr.min===null&&dr.max===null?row('duration','المدة','unknown','مدة الفرصة غير موثقة'):dm===null?row('duration','المدة','unknown','تعذر قراءة مدة المشروع'):(dr.max!==null&&dm>dr.max)||(dr.min!==null&&dm<dr.min)?row('duration','المدة','unmet','مدة المشروع '+dm+' شهرًا خارج النطاق'):row('duration','المدة','met','ضمن النطاق'));
 const st=statusFor(terms,o,today);criteria.push(row('status','حالة التقديم',st==='closed'?'unmet':st==='open'||st==='rolling'?'met':'unknown',APP_STATUS[st]+(o.closes_at?' — الإغلاق '+o.closes_at:'')));
 for(const k of terms.readiness){const s=docs[k],label='جاهزية: '+READINESS[k];criteria.push(s==='ok'?row('doc_'+k,label,'met','الوثيقة جاهزة'):s==='missing'||s==='expired'?row('doc_'+k,label,'unmet',s==='expired'?'الوثيقة منتهية':'الوثيقة ناقصة'):row('doc_'+k,label,'unknown',s==='partial'||s==='stale'?'الوثيقة جزئية أو قديمة':'حالة الوثيقة غير مسجلة'));}
 const hard=['entity','region','status','amount','duration'],blockers=criteria.filter(c=>c.status==='unmet'&&(hard.includes(c.key)||c.key.startsWith('doc_'))),documented=criteria.filter(c=>c.status!=='unknown').length;
 const gaps=criteria.filter(c=>c.status==='unknown').map(c=>c.detail);
 const verdict=blockers.length?'blocked':criteria.every(c=>c.status==='met')?'candidate_ok':'needs_review';
 return {projectId:p.id,name:p.name,score:topics.length?Math.round(100*common.length/topics.length):0,coverage:Math.round(100*documented/criteria.length),criteria,blockers:blockers.map(b=>b.label+': '+b.detail),gaps,verdict,closed:st==='closed',eligible:null,needsHumanReview:true,reasons:common.length?['مجالات مشتركة: '+common.map(name).join('، ')]:['لم تثبت مجالات مشتركة']};
}
const RANK={candidate_ok:0,needs_review:1,blocked:2};
export const byFit=(a,b)=>RANK[a.verdict]-RANK[b.verdict]||b.score-a.score||b.coverage-a.coverage;
