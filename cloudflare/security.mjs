import {scrypt} from 'node:crypto';
import {HttpError} from '../server/errors.js';
import {password as validatePassword} from '../server/validation.js';
export const now=()=>new Date().toISOString();
export const fail=(status,message,code='INVALID_REQUEST')=>{throw new HttpError(status,message,code);};
export const token=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const digest=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
async function derive(value,salt){return new Promise((resolve,reject)=>scrypt(value,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024},(err,key)=>err?reject(err):resolve(Buffer.from(key).toString('base64'))));}
export async function hashPassword(value){validatePassword(value);const salt=crypto.getRandomValues(new Uint8Array(16));return ['scrypt','16384','8','5',Buffer.from(salt).toString('base64'),await derive(value,salt)].join('$');}
export async function verifyPassword(value,encoded){if(typeof value!=='string'||value.length>128)return false;const p=String(encoded||'').split('$');const valid=p.length===6&&p[0]==='scrypt'&&p[1]==='16384'&&p[2]==='8'&&p[3]==='5'&&Buffer.from(p[4],'base64').length===16&&Buffer.from(p[5],'base64').length===32;const actual=await derive(value,valid?Buffer.from(p[4],'base64'):new Uint8Array(16));return valid&&equal(actual,p[5]);}
export const publicUser=u=>({id:u.id,username:u.username,displayName:u.display_name,role:u.role,active:!!u.active,mustChangePassword:!!u.must_change_password});
export const COOKIE='radar_v13_dev_session';
export function cookie(value,clear=false){return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear?0:43200}`;}
export function readCookie(req){const pair=(req.headers.get('cookie')||'').split(';').find(x=>x.trim().startsWith(COOKIE+'='));if(!pair)return '';try{return decodeURIComponent(pair.trim().slice(COOKIE.length+1));}catch{return '';}}
