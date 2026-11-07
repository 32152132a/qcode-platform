import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { extname, dirname, join } from 'node:path';
import { createRequire } from 'node:module';

function checkArchive(bytes) {
  let total = 0, entries = 0;
  for (let i = 0; i + 46 <= bytes.length; i++) if (bytes.readUInt32LE(i) === 0x02014b50) {
    total += bytes.readUInt32LE(i + 24); entries++;
    if (total > 32 * 1024 * 1024 || entries > 4000) throw new Error('Office文件解压内容过大，请拆分后上传');
    i += 45 + bytes.readUInt16LE(i + 28) + bytes.readUInt16LE(i + 30) + bytes.readUInt16LE(i + 32);
  }
  if (!entries) throw new Error('Office文件格式无效');
}
function unescapeHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
export function markdownBlocks(content, source = {}) {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n').split('\n'), blocks = [];
  let current = { title:'文档内容',level:0,text:[],source:{...source,lineStart:1} }, fence = '';
  const flush = end => { blocks.push({...current,text:current.text.join('\n').trim(),source:{...current.source,lineEnd:end}}); };
  for (const [i,line] of lines.entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) { if (!fence) fence=marker[1]; else if (marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim()) fence=''; }
    const heading = !fence && !marker && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { flush(i);current={title:heading[2],level:heading[1].length,text:[],source:{...source,lineStart:i+1}}; }
    current.text.push(line);
  }
  flush(lines.length);
  return blocks.filter(block=>block.text);
}
async function extract(filename, bytes) {
  const extension = extname(filename).toLowerCase(); let blocks;
  if (extension === '.md' || extension === '.txt') {
    const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if (text.includes('\0')) throw new Error('文件不是UTF-8纯文本');
    blocks = markdownBlocks(text);
  } else if (extension === '.pdf') {
    if (!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF文件格式无效');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const packageRoot=dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    const resource=folder=>join(packageRoot,folder).replaceAll('\\','/')+'/';
    const task = getDocument({ data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useWorkerFetch:false,standardFontDataUrl:resource('standard_fonts'),cMapUrl:resource('cmaps'),cMapPacked:true });
    const pdf = await task.promise; blocks=[];
    try {
      if (pdf.numPages > 200) throw new Error('PDF最多200页，请拆分上传');
      for (let page=1;page<=pdf.numPages;page++) {
        const value=await pdf.getPage(page), text=await value.getTextContent();
        const content=text.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
        if (!content) throw new Error(`第${page}页没有可提取的文字，请先识别扫描件或移除空白页`);
        blocks.push({title:`第${page}页`,level:1,text:content,source:{page}});value.cleanup();
      }
    } finally { await task.destroy(); }
  } else if (extension === '.docx') {
    checkArchive(bytes);
    const { default:mammoth } = await import('mammoth');
    const result=await mammoth.convertToHtml({buffer:bytes},{convertImage:mammoth.images.imgElement(()=>({src:''}))});
    const text=result.value.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g,(_,level,title)=>'\n\n'+'#'.repeat(Number(level))+' '+unescapeHtml(title)+'\n\n')
      .replace(/<\/t[dh]>/g,' | ').replace(/<\/tr>/g,'\n').replace(/<\/(?:p|table|ul|ol)>/g,'\n\n').replace(/<br\s*\/?>/g,'\n');
    blocks=markdownBlocks(unescapeHtml(text),{format:'docx'});
  } else if (extension === '.xlsx') {
    checkArchive(bytes);
    const { default:ExcelJS } = await import('exceljs');
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);blocks=[];let cellCount=0;
    for (const sheet of workbook.worksheets) {
      let rows=[],start=0,end=0,first=true;
      const flush=()=>{if(rows.length){blocks.push({title:`${sheet.name}：第${start}～${end}行`,level:first?1:2,text:rows.join('\n'),source:{sheet:sheet.name,rowStart:start,rowEnd:end}});first=false;}rows=[];};
      sheet.eachRow((row,number)=>{
        const cells=[];row.eachCell(cell=>{if(++cellCount>20000)throw new Error('Excel最多提取20000个非空单元格，请拆分上传');cells.push(`${cell.address}: ${cell.type===ExcelJS.ValueType.Formula&&cell.result===undefined?'[公式无缓存值，未计算]':cell.text}`);});
        if(!rows.length)start=number;end=number;rows.push(cells.join(' | '));
        if(rows.join('\n').length>1200)flush();
      });flush();
    }
  } else throw new Error('不支持的文件格式');
  const total=blocks.reduce((size,block)=>size+block.text.length,0);
  if(!total||total>200000)throw new Error('正文为空或超过20万字符，请拆分上传');
  return blocks;
}
export function parseKnowledgeFile(filename,bytes,{signal}={}) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const worker=new Worker(new URL(import.meta.url),{workerData:{filename,bytes},resourceLimits:{maxOldGenerationSizeMb:256}});
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(new Error('资料处理已停止'));
    const timer=setTimeout(()=>finish(new Error('解析超过60秒，请拆分文件后重试')),60000);
    worker.once('message',result=>result.error?finish(new Error(result.error)):finish(null,result.blocks));
    worker.once('error',error=>finish(error));worker.once('exit',code=>{if(code!==0)finish(new Error('解析进程已退出，请拆分文件后重试'));});
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
}
if(!isMainThread){try{parentPort.postMessage({blocks:await extract(workerData.filename,Buffer.from(workerData.bytes))});}catch(error){parentPort.postMessage({error:error.message});}}
