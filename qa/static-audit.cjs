const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),files=fs.readdirSync(root),errors=[];
const js=files.filter(f=>f.endsWith('.js')),html=files.filter(f=>f.endsWith('.html'));
for(const f of js){try{new vm.Script(fs.readFileSync(path.join(root,f),'utf8'),{filename:f});}catch(e){errors.push({file:f,error:e.message});}}
let references=0;
for(const f of html){const text=fs.readFileSync(path.join(root,f),'utf8');for(const m of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)){const ref=m[1];if(/^(https?:|data:|blob:|mailto:|tel:|#)/.test(ref))continue;const clean=ref.split(/[?#]/)[0]||'index.html';references++;const target=path.resolve(root,clean);if(!fs.existsSync(target))errors.push({file:f,reference:ref,error:'Missing local target'});}}
console.log(JSON.stringify({javascriptFiles:js.length,htmlFiles:html.length,localReferences:references,errors},null,2));
process.exitCode=errors.length?1:0;
