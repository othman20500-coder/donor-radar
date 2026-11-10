'use strict';
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline/promises');
const {config}=require('../server/config');
const {acquireLease}=require('../server/lease');
function settings(){return config({rootDir:path.resolve(__dirname,'..')});}
function openStore(){const cfg=settings(),catalog=JSON.parse(fs.readFileSync(cfg.catalogPath,'utf8'));const {Store}=require('../server/store'),release=acquireLease(cfg.dataDir);let store;try{store=new Store({dataDir:cfg.dataDir,catalog});}catch(e){release();throw e;}return{cfg,store,close:()=>{store.close();release();}};}
async function ask(prompt){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('شغّل هذا الأمر داخل Terminal تفاعلي. لن تُقرأ كلمات المرور من المعاملات أو الملفات.');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});try{return(await rl.question(prompt)).trim();}finally{rl.close();}
}
function secret(prompt){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('أدخل كلمة المرور داخل Terminal تفاعلي.');
 return new Promise((resolve,reject)=>{
  process.stdout.write(prompt);let value='',finished=false;const raw=process.stdin.isRaw;process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
  function finish(error){if(finished)return;finished=true;process.stdin.off('data',onData);process.stdin.setRawMode(!!raw);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value);}
  function onData(chunk){for(const ch of chunk){if(ch==='\u0003'||ch==='\u0004'){finish(new Error('أُلغي الأمر.'));return;}if(ch==='\r'||ch==='\n'){finish();return;}if(ch==='\u007f'||ch==='\b'){value=Array.from(value).slice(0,-1).join('');continue;}if(ch<' ')continue;value+=ch;if(value.length>128){finish(new Error('كلمة المرور أطول من 128 حرفًا.'));return;}}}
  process.stdin.on('data',onData);
 });
}
function fail(error){console.error(error?.status?error.message:error?.message||'تعذر إتمام الأمر.');process.exitCode=1;}
module.exports={settings,openStore,ask,secret,fail};
