// Minimal RSS 2.0 / Atom reader for official announcement feeds. It never fetches anything itself.
import {canonicalLink,GRANT} from './vendor/discovery.cjs';
import {readableText} from './vendor/pure.cjs';
const MAX_ITEMS=30;
const NAMED={lt:'<',gt:'>',quot:'"',apos:"'",amp:'&',nbsp:' ',laquo:'«',raquo:'»',hellip:'…',ndash:'–',mdash:'—'};
function decodeOnce(s){return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,k)=>{if(k[0]==='#'){const n=k[1]==='x'||k[1]==='X'?parseInt(k.slice(2),16):parseInt(k.slice(1),10);return Number.isFinite(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):m;}return Object.hasOwn(NAMED,k.toLowerCase())?NAMED[k.toLowerCase()]:m;});}
function decode(s){const t=String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');return decodeOnce(decodeOnce(t));}
function tag(block,name){const m=new RegExp('<'+name+'\\b[^>]*>([\\s\\S]*?)</'+name+'\\s*>','i').exec(block);return m?decode(m[1]).trim():'';}
function atomLink(block){const all=[...block.matchAll(/<link\b([^>]*?)\/?>/gi)];const alt=all.find(m=>!/\brel\s*=/.test(m[1])||/\brel\s*=\s*["']alternate["']/.test(m[1]))||all[0];const h=alt&&/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(alt[1]);return h?(h[1]??h[2]):'';}
function isoDay(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;}
/** Returns candidates only for items that pass the grant vocabulary filter and stay on the feed's origin. */
export function parseFeed(xml,base){
 if(typeof xml!=='string'||!/<(rss|feed|rdf:RDF)\b/i.test(xml))throw Error('محتوى ليس خلاصة RSS أو Atom');
 const blocks=xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi)||[];const out=[],seen=new Set();
 for(const b of blocks){
  const title=readableText(tag(b,'title')).slice(0,250),summary=readableText(decode(tag(b,'description')||tag(b,'summary')||tag(b,'content'))).slice(0,2000),href=tag(b,'link')||atomLink(b);
  if(title.length<5||!GRANT.test(title+' '+summary))continue;
  let link;try{link=canonicalLink(href,base);}catch{continue;}
  if(seen.has(link))continue;seen.add(link);
  out.push({title,sourceUrl:link,summary,publishedAt:isoDay(tag(b,'pubDate')||tag(b,'published')||tag(b,'updated')||tag(b,'dc:date')),raw:b.slice(0,6000)});
  if(out.length>=MAX_ITEMS)break;
 }
 return out;
}
