export function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted && text[i+1]==='"'){field+='"';i++;}
      else if(quoted)quoted=false;
      else if(field==='')quoted=true;
      else throw new Error('CSV 引号格式错误');
    }else if(char===','&&!quoted){row.push(field);field='';}
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(value=>value.trim()))rows.push(row);row=[];field='';}
    else field+=char;
  }
  if(quoted)throw new Error('CSV 引号未闭合');
  row.push(field);if(row.some(value=>value.trim()))rows.push(row);return rows;
}
export async function importUsersCsv(api){
  const picker=document.createElement('input');picker.type='file';picker.accept='.csv,text/csv';
  const file=await new Promise(resolve=>{picker.onchange=()=>resolve(picker.files[0]);picker.oncancel=()=>resolve(null);picker.click();});
  if(!file)return;
  if(file.size>256000)throw new Error('CSV 文件超过 256 KB');
  const rows=parseCsv(await file.text()),header=rows.shift()?.map(x=>x.trim());
  if(!header || !header.includes('用户名') || !header.includes('初始密码'))throw new Error('请使用模板，至少包含 用户名、初始密码 两列');
  const departments=await api('/admin/departments');
  const users=rows.map((row,index)=>{
    const value=Object.fromEntries(header.map((key,i)=>[key,row[i]||'']));
    const department=departments.find(d=>d.name===value['部门']);
    if(value['部门']&&!department)throw new Error(`第 ${index+2} 行的部门不存在，请先创建部门`);
    return {username:value['用户名'].trim(),password:value['初始密码'],departmentId:department?.id||null,quotaMode:'department'};
  });
  if(!users.length||users.length>100)throw new Error('每次导入 1–100 个员工');
  await api('/admin/users/import','POST',{users});
}
export function downloadText(filename,text,type='text/csv;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
