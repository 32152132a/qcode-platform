import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
const marker = '.qcode-managed.json';
async function ordinaryDirectory(directory) {
  try { const stat=await fs.lstat(directory); if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Skill 目录不能是链接或普通文件'); }
  catch(error){if(error.code==='ENOENT')await fs.mkdir(directory,{recursive:true});else throw error;}
}
function within(root,value) { const target=path.resolve(root,value); if(!target.startsWith(path.resolve(root)+path.sep))throw new Error('Skill 路径越界'); return target; }
function validate(skill) {
  if(!/^[a-f0-9]{32}$/.test(skill.id)||!/^[a-z][a-z0-9-]{0,63}$/.test(skill.name)||!skill.files||typeof skill.files!=='object'||Array.isArray(skill.files))throw new Error('无效的 Skill 清单');
  if(!Object.hasOwn(skill.files,'SKILL.md')||Object.keys(skill.files).length>31||Buffer.byteLength(JSON.stringify(skill.files))>1024*1024)throw new Error('Skill 内容缺失或超过限制');
  const names=[];
  for(const [filename,content]of Object.entries(skill.files)){
    if(!/^[a-zA-Z0-9_./-]+$/.test(filename)||filename.startsWith('/')||filename.split('/').some(p=>!p||p==='.'||p==='..'||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))||typeof content!=='string')throw new Error('Skill 文件路径不安全');
    const name=filename.toLowerCase();if(names.some(n=>n===name||n.startsWith(name+'/')||name.startsWith(n+'/')))throw new Error('Skill 文件路径冲突');names.push(name);
  }
  if(createHash('sha256').update(JSON.stringify(skill.files)).digest('hex')!==skill.revision)throw new Error('Skill 完整性校验失败');
}
export async function syncSkills(home,skills) {
  if(!Array.isArray(skills)||skills.length>500)throw new Error('Skill 清单过大');
  for(const skill of skills)validate(skill);
  if(new Set(skills.map(s=>s.id)).size!==skills.length)throw new Error('重复的 Skill 标识');
  await ordinaryDirectory(home); const root=path.join(home,'skills'); await ordinaryDirectory(root);
  const desired=new Set(skills.map(skill=>'qcode-'+skill.id));
  for(const skill of skills){
    const name='qcode-'+skill.id, target=within(root,name);
    let existing;
    try {await ordinaryDirectory(target);existing=JSON.parse(await fs.readFile(path.join(target,marker),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(existing && existing.id!==skill.id)throw new Error('发现非 QCode 管理的同名 Skill，请手动检查');
    if(!existing && (await fs.readdir(target)).length)throw new Error('目标 Skill 目录已有用户文件，未覆盖');
    if(existing?.revision===skill.revision)continue;
    const staging=within(root,`.qcode-stage-${randomBytes(8).toString('hex')}`), previous=within(root,`.qcode-old-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(staging);
    try {
      for(const [filename,content]of Object.entries(skill.files)){const output=within(staging,filename);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,content,{mode:0o600});}
      await fs.writeFile(path.join(staging,marker),JSON.stringify({id:skill.id,revision:skill.revision}));
      await fs.rename(target,previous);
      try{await fs.rename(staging,target);}catch(error){await fs.rename(previous,target);throw error;}
      await fs.rm(previous,{recursive:true,force:true});
    }finally{await fs.rm(staging,{recursive:true,force:true});}
  }
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
    if(!/^qcode-[a-f0-9]{32}$/.test(entry.name)||desired.has(entry.name))continue;
    if(entry.isSymbolicLink()||!entry.isDirectory())throw new Error('托管 Skill 目录被替换为链接，停止同步');
    const target=within(root,entry.name);
    let owner;try{owner=JSON.parse(await fs.readFile(path.join(target,marker),'utf8'));}catch{continue;}
    if('qcode-'+owner.id===entry.name)await fs.rm(target,{recursive:true,force:true});
  }
}
