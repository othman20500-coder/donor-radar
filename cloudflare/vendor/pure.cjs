'use strict';
function sourceUrl(value){let u;try{u=new URL(value);}catch{throw Error('رابط غير صالح');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)throw Error('رابط غير مسموح');const h=u.hostname.toLowerCase();if(!h||!h.includes('.')||['localhost','local','internal','test','invalid','onion'].some(x=>h===x||h.endsWith('.'+x))||h.includes(':')||/^\d+(?:\.\d+){3}$/.test(h))throw Error('مضيف غير مسموح');return u.toString();}
function readableText(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
module.exports={sourceUrl,readableText};
