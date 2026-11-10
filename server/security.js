'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {HttpError}=require('./errors');
const {password}=require('./validation');
const scrypt=promisify(crypto.scrypt);
const COST=131072,R=8,P=1,MAXMEM=256*1024*1024;
function hashToken(token){return crypto.createHash('sha256').update(token).digest('hex');}
function randomToken(){return crypto.randomBytes(32).toString('base64url');}
async function hashPassword(value){
 password(value);const salt=crypto.randomBytes(16);const derived=await scrypt(value,salt,32,{N:COST,r:R,p:P,maxmem:MAXMEM});
 return['scrypt',COST,R,P,salt.toString('base64'),derived.toString('base64')].join('$');
}
async function verifyPassword(value,encoded){
 if(typeof value!=='string'||value.length>128)return false;
 let n=COST,r=R,p=P,salt=Buffer.alloc(16,1),expected=Buffer.alloc(32);
 if(typeof encoded==='string'){
  const a=encoded.split('$');if(a.length!==6||a[0]!=='scrypt')return false;
  n=+a[1];r=+a[2];p=+a[3];if(n!==COST||r!==R||p!==P)return false;
  salt=Buffer.from(a[4],'base64');expected=Buffer.from(a[5],'base64');if(salt.length!==16||expected.length!==32)return false;
 }
 const actual=await scrypt(value,salt,32,{N:n,r,p,maxmem:MAXMEM});
 return crypto.timingSafeEqual(actual,expected)&&!!encoded;
}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function readCookie(req,name){const raw=req.headers.cookie||'';if(raw.length>16384)return'';const pairs=raw.split(';');for(const pair of pairs){const p=pair.indexOf('=');if(p>=0&&pair.slice(0,p).trim()===name){try{return decodeURIComponent(pair.slice(p+1).trim());}catch{return'';}}}return'';}
function cookie(token,config,clear=false){return config.cookieName+'='+encodeURIComponent(token)+'; Path='+config.cookiePath+'; HttpOnly; SameSite=Strict; '+(config.secure?'Secure; ':'')+'Max-Age='+(clear?0:43200);}
function checkOrigin(req,config){
 const origin=req.headers.origin;if(origin!==config.origin)throw new HttpError(403,'مصدر الطلب غير مسموح.','INVALID_ORIGIN');
 if(req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'الطلب من موقع آخر غير مسموح.','INVALID_ORIGIN');
}
function headers(res,nonce){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Cache-Control','no-store');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}
module.exports={hashToken,randomToken,hashPassword,verifyPassword,equal,readCookie,cookie,checkOrigin,headers};
