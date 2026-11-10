#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const source=read('source/base-v9.html'),adapter=read('client/team.js'),styles=read('client/team.css');
const projects=read('client/projects.js'),projectStyles=read('client/projects.css');
const renewalModel=read('client/renewal-model.js'),renewal=read('client/renewal.js'),renewalStyles=read('client/renewal.css');
const marker='/* Single application bootstrap. */';
if(source.split(marker).length!==2||[adapter,projects,renewalModel,renewal].some(code=>/<\/script/i.test(code)))throw Error('Invalid team source boundary');
let html=source.replace(marker,'/* Team edition v10: authenticated server storage. */\n'+adapter+'\n\n/* Project workspace refinement. */\n'+projects+'\n\n/* Funding renewal. */\n'+renewalModel+'\n'+renewal+'\n\n'+marker)
 .replace('</head>','<style id="radar-team">\n'+styles+'\n</style>\n<style id="radar-projects">\n'+projectStyles+'\n</style>\n<style id="radar-renewal">\n'+renewalStyles+'\n</style>\n</head>')
 .replace('<title>رادار المانحين | جمعية التنمية الأهلية بالمعذر</title>',
 '<title>رادار المانحين — مساحة الفريق | جمعية التنمية الأهلية بالمعذر</title>');
fs.writeFileSync(path.join(__dirname,'private/app/index.html'),html);
const manifest=JSON.parse(read('private/build-manifest.json'));
manifest.indexSha256=crypto.createHash('sha256').update(html).digest('hex');
fs.writeFileSync(path.join(__dirname,'private/build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Team interface built. Original project files are unchanged.');
