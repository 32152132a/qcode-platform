import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GatewaySession } from './bridge.mjs';
import { secureStore, gatewayAddress, lockSession } from './session-store.mjs';

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QCode · 登录</title><style nonce="NONCE">*{box-sizing:border-box}body{margin:0;font:15px/1.7 "Segoe UI","Microsoft YaHei",sans-serif;color:#203c37;background:#f5f7f4;min-height:100vh;display:grid;place-items:center;padding:28px}main{width:min(100%,420px);padding:36px;background:#fff;border:1px solid #e0e8e2;border-radius:18px;box-shadow:0 20px 60px #203c370c}img{width:48px;height:48px}h1{font-size:26px;margin:20px 0 8px}p{color:#71827c;margin:0 0 24px}form,label{display:grid;gap:10px}form{gap:20px}input,button{font:inherit;padding:12px;border:1px solid #d7e2da;border-radius:8px;min-width:0}input{width:100%}button{cursor:pointer;background:#176b54;color:white}button:disabled{opacity:.6;cursor:wait}.password{display:grid;grid-template-columns:1fr auto;gap:8px}.password button{background:#f0f4f0;color:#446153;width:48px}#status{font-size:13px;overflow-wrap:anywhere;margin:24px 0 0}#status[data-error=true]{color:#a74535}#stop{display:none;background:#f0f4f0;color:#446153;margin-top:16px;width:100%}:focus-visible{outline:3px solid #d69b44;outline-offset:2px}</style></head><body><main><img src="/icon.png" alt=""><h1>登录 QCode</h1><p>使用团队账号，登录后进入编程工作台。</p><form id="login"><label>用户名<input name="username" autocomplete="username" maxlength="80" required autofocus></label><label>密码<span class="password"><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required><button type="button" id="eye" aria-label="显示密码" aria-pressed="false">◉</button></span></label><button id="submit" type="submit">登录并打开工作台</button></form><p id="status" role="status" aria-live="polite">正在检查登录状态…</p><button type="button" id="stop">关闭 QCode</button></main><script nonce="NONCE">
const launchToken=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const form=document.getElementById('login'),status=document.getElementById('status'),submit=document.getElementById('submit'),password=document.getElementById('password');
let timer,stopped=false,redirecting=false;
async function request(route,body){const response=await fetch(route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-QCode-Launch':launchToken},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.message||'访问链接已失效，请重新打开 QCode');return data;}
function show(data){status.textContent=data.message;status.dataset.error=String(data.state==='error'||!!data.notice);form.hidden=['starting','ready'].includes(data.state);submit.disabled=data.state==='starting';document.getElementById('stop').style.display='block';if(data.state==='ready'&&!redirecting){redirecting=true;setTimeout(()=>{if(!stopped)location.assign(data.url);},data.notice?5000:0);}}
async function poll(){if(stopped)return;try{show(await request('/status'));timer=setTimeout(poll,1000);}catch(e){status.textContent='本地服务已关闭，请重新打开 QCode。';status.dataset.error='true';submit.disabled=true;}}
document.getElementById('eye').onclick=()=>{const visible=password.type==='password';password.type=visible?'text':'password';const eye=document.getElementById('eye');eye.setAttribute('aria-label',visible?'隐藏密码':'显示密码');eye.setAttribute('aria-pressed',String(visible));};
form.onsubmit=async event=>{event.preventDefault();clearTimeout(timer);submit.disabled=true;status.dataset.error='false';status.textContent='正在登录…';try{const username=form.elements.username.value;const secret=password.value;password.value='';show(await request('/login',{username,password:secret}));}catch(e){status.textContent=e.message;status.dataset.error='true';submit.disabled=false;}timer=setTimeout(poll,1000);};
document.getElementById('stop').onclick=async()=>{stopped=true;clearTimeout(timer);try{await request('/stop',{});}finally{form.hidden=true;status.textContent='QCode 已关闭，可以关闭这个页面。';}};
poll();
</script></body></html>`;

export async function startWebLogin({ gateway, store, hasSavedSession = false, startClient, iconPath, onClose = () => {} }) {
  gateway=gatewayAddress(gateway);
  const token=randomBytes(32).toString('base64url');let origin,client,busy=false,closed=false;
  let state={state:'login',message:'请输入团队账号和密码。'};
  function authenticated(req){const supplied=Buffer.from(req.headers['x-qcode-launch']||''),expected=Buffer.from(token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
  const sockets=new Set();
  async function start(){
    if(closed)return;
    state={state:'starting',message:'登录成功，正在启动编程工作台…'};
    let updateNotice='';
    try{
      client=startClient(message=>{if(!closed&&state.state==='starting'){if(message.includes('更新未完成'))updateNotice=message;state={state:'starting',message};}});
      client.closed.then(code=>{if(!closed){if(state.state==='ready'){void close();return;}state={state:'error',message:code?'启动或运行失败，请重新登录重试，或运行 qcode doctor 检查。':'工作台已关闭，可以重新登录启动。'};client=null;}}).catch(()=>{});
      const url=await client.ready;const parsed=new URL(url);
      if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.username||parsed.password||parsed.pathname!=='/_qcode/start')throw Error('Invalid Web launch address');
      state={state:'ready',message:updateNotice?`${updateNotice}。当前版本已就绪，5 秒后进入工作台。`:'工作台已就绪，正在打开…',url,...(updateNotice?{notice:true}:{})};
    }catch{await client?.stop();client=null;state={state:'error',message:'工作台启动失败，请重试，或运行 qcode doctor 检查。'};}
  }
  const server=http.createServer(async(req,res)=>{
    const json=(status,value)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!==new URL(origin).host || (req.headers.origin&&req.headers.origin!==origin))return json(403,{message:'不允许此来源访问'});
    if(req.method==='GET'&&req.url==='/'){
      const nonce=randomBytes(16).toString('base64');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
      return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(page.replaceAll('NONCE',nonce));
    }
    if(req.method==='GET'&&req.url==='/icon.png'){
      if(iconPath&&fs.existsSync(iconPath))return res.writeHead(200,{'Content-Type':'image/png'}).end(fs.readFileSync(iconPath));
      return res.writeHead(404).end();
    }
    if(!authenticated(req))return json(401,{message:'访问链接已失效，请重新打开 QCode'});
    if(req.method==='GET'&&req.url==='/status')return json(200,state);
    if(req.method==='POST'&&req.headers.origin!==origin)return json(403,{message:'不允许此来源访问'});
    if(req.method==='POST'&&req.url==='/stop'){json(200,{ok:true});setImmediate(()=>void close());return;}
    if(req.method!=='POST'||req.url!=='/login')return json(404,{message:'页面不存在'});
    if(busy||client)return json(409,{message:'正在启动或已有工作台运行，请稍候。'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{message:'无效的登录格式'});
    busy=true;
    try{
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)return json(413,{message:'登录信息过长'});chunks.push(chunk);}
      let credentials;try{credentials=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(400,{message:'无效的登录信息'});}
      if(typeof credentials.username!=='string'||!credentials.username.trim()||credentials.username.length>80||typeof credentials.password!=='string'||!credentials.password||credentials.password.length>256)return json(400,{message:'请输入用户名和密码'});
      const response=await fetch(gateway+'/auth/login',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,device:'QCode Web / '+process.platform}),signal:AbortSignal.timeout(15000)});
      credentials=null;const session=await response.json();
      if(!response.ok){const messages={LOGIN_FAILED:'用户名或密码错误，请重新输入。',USER_DISABLED:'账号已被禁用，请联系管理员。',SESSION_LIMIT:'登录设备数量已达上限，请退出其他设备或联系管理员。',LOGIN_RATE_LIMIT:'登录尝试过多，请稍后再试。'};state={state:'login',message:messages[session.error?.code]||'登录失败，请检查账号或联系管理员。'};return json(response.status,state);}
      if(!session.token||!session.user?.id)throw Error('Invalid login response');
      if(closed){await fetch(gateway+'/auth/logout',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)}).catch(()=>{});return;}
      try{store.write(session);}catch(error){await fetch(gateway+'/auth/logout',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)}).catch(()=>{});throw error;}
      state={state:'starting',message:'登录成功，正在启动编程工作台…'};json(200,state);void start();
    }catch{state={state:'login',message:'登录未完成，请检查网络和本地加密存储后重试。'};if(!res.writableEnded)json(502,state);}
    finally{busy=false;}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  async function close(){if(closed)return;closed=true;await client?.stop();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));onClose();}
  if(hasSavedSession){
    state={state:'starting',message:'正在恢复登录状态…'};
    void (async()=>{try{const saved=new GatewaySession(gateway,store.read(),value=>store.write(value));await saved.json('/auth/me');await start();}catch{state={state:'login',message:'登录状态已失效，请重新登录。'};}})();
  }
  return { origin,url:origin+'/#'+token,close };
}

function clientProcess(args,onProgress){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./launcher.mjs',import.meta.url)),...args,'--no-open','true'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,QCODE_WEB_LOGIN_CHILD:'1'}});
  child.stdout.setEncoding('utf8');
  let readyDone=false,buffer='';
  let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  let timer;
  function waitForStartup(milliseconds){clearTimeout(timer);timer=setTimeout(()=>{if(!readyDone){readyDone=true;rejectReady(Error('Startup timeout'));}},milliseconds);}
  waitForStartup(90000);
  const closed=new Promise(resolve=>{child.once('error',()=>{clearTimeout(timer);if(!readyDone){readyDone=true;rejectReady(Error('Launcher failed'));}resolve(1);});child.once('exit',code=>{clearTimeout(timer);if(!readyDone){readyDone=true;rejectReady(Error('Launcher stopped'));}resolve(code||0);});});
  child.stdout.on('data',bytes=>{buffer+=bytes.toString();let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(line.startsWith('QCode 更新：')){if(!readyDone&&/下载|校验|安装|切换/.test(line))waitForStartup(600000);onProgress?.(line.slice(9));}if(line.startsWith('QCode Web: ')&&!readyDone){readyDone=true;clearTimeout(timer);resolveReady(line.slice(11));}}if(buffer.length>65536)buffer=buffer.slice(-4096);});child.stderr.resume();
  return {ready,closed,stop:async()=>{if(child.exitCode!==null)return;if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await new Promise(resolve=>{killer.once('exit',resolve);killer.once('error',resolve);});}else child.kill();}};
}
async function main(){
  const args=Object.fromEntries(process.argv.slice(2).reduce((all,value,index,array)=>{if(value.startsWith('--'))all.push([value.slice(2),array[index+1]]);return all;},[]));
  if(!args.gateway||!args.session||!args.entry)throw Error('Missing client launch options');
  // Protect the login phase too; the existing launcher takes over this lock at startup.
  let login;
  const launchFile=path.join(path.dirname(args.session),'web-launch.json'),localStore=secureStore(launchFile);
  function openBrowser(url){const browser=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true});browser.once('error',()=>void login?.close().then(()=>{process.exitCode=1;}));browser.once('exit',code=>{if(code)void login?.close().then(()=>{process.exitCode=1;});});}
  try{
    if(fs.existsSync(launchFile)){const saved=localStore.read(),url=new URL(saved.token);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||!url.hash)throw Error('Invalid local link');const response=await fetch(url.origin+'/status',{headers:{'X-QCode-Launch':url.hash.slice(1)},signal:AbortSignal.timeout(2000)});if(response.ok){console.log('QCode 登录页面: '+url.href);if(args['no-open']!=='true')openBrowser(url.href);return;}}
  }catch{ /* Stale encrypted local links do not replace gateway credentials. */ }
  let release=lockSession(path.join(path.dirname(args.session),'running.lock'));
  const launchArgs=['--gateway',args.gateway,'--session',args.session,'--entry',args.entry,'--mode','web',...(args.runtime?['--runtime',args.runtime]:[]),...(args.workdir?['--workdir',args.workdir]:[])];
  try{
    login=await startWebLogin({gateway:args.gateway,store:secureStore(args.session),hasSavedSession:fs.existsSync(args.session),iconPath:fileURLToPath(new URL('./branding/qcode-96.png',import.meta.url)),startClient:onProgress=>{release?.();release=null;return clientProcess(launchArgs,onProgress);},onClose:()=>{if(release){const unlock=release;release=null;unlock();}try{if(localStore.read().user.id===process.pid)fs.unlinkSync(launchFile);}catch{}}});
    localStore.write({token:login.url,user:{id:process.pid,username:'local-launch'}});
    console.log('QCode 登录页面: '+login.url);
    if(args['no-open']!=='true')openBrowser(login.url);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void login.close());
  }catch(error){await login?.close();release?.();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('QCode 网页启动失败；若已运行，请先关闭原客户端。可运行 qcode doctor 检查。');process.exitCode=1;});
