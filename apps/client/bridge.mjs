import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gatewayAddress } from './session-store.mjs';
export class GatewaySession {
  constructor(gateway, session, save) { this.gateway=gatewayAddress(gateway); this.session=session; this.save=save; this.refreshing=null; }
  async renew(force=false) {
    if (!force && this.session.token && new Date(this.session.expiresAt).getTime()>Date.now()+60000) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing=(async()=>{
      const response=await fetch(this.gateway+'/auth/refresh',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.session.token}`},body:JSON.stringify({refreshToken:this.session.refreshToken}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error?.message || '会话续期失败，请重新登录'),{code:data.error?.code,status:response.status});
      // Persist before publishing to callers. A disk failure is surfaced rather than silently losing the new refresh credential.
      await this.save(data); this.session=data;
    })();
    try { await this.refreshing; } finally { this.refreshing=null; }
  }
  async fetch(route, options={}) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid gateway route');
    await this.renew();
    const send=()=>fetch(this.gateway+route,{...options,redirect:'error',headers:{...options.headers,Authorization:`Bearer ${this.session.token}`}});
    let response=await send();
    // Only authentication rejection is replayed: it occurs before the gateway sends a model request.
    if (response.status===401) { await response.body?.cancel(); await this.renew(true); response=await send(); }
    return response;
  }
  async json(route) {
    const response=await this.fetch(route,{signal:AbortSignal.timeout(15000)}), data=await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error?.message || '网关请求失败'),{code:data.error?.code,status:response.status});
    return data;
  }
}
export async function startBridge(session,{onConfig=async()=>{}}={}) {
  const localToken=randomBytes(32).toString('base64url');
  let configuration=await session.json('/client/config'), lastConfig=Date.now(), refreshingConfig;
  async function refreshConfig(force=false) {
    if (!force && Date.now()-lastConfig<60000) return configuration;
    if (!refreshingConfig) refreshingConfig=(async()=>{configuration=await session.json('/client/config');lastConfig=Date.now();await onConfig(configuration);return configuration;})();
    try { return await refreshingConfig; } finally { refreshingConfig=null; }
  }
  const controllers=new Set();
  const server=http.createServer(async(req,res)=>{
    const supplied=(req.headers.authorization || '').replace(/^Bearer /i,''), a=Buffer.from(supplied), b=Buffer.from(localToken);
    res.setHeader('Cache-Control','no-store');
    if (a.length!==b.length || !timingSafeEqual(a,b)) { res.writeHead(401,{'Content-Type':'application/json'}).end('{"error":{"code":"LOCAL_AUTH_REQUIRED","message":"Local client authentication required"}}');return; }
    if (req.headers.origin) { res.writeHead(403).end(); return; }
    const controller=new AbortController();controllers.add(controller);
    const timeout=setTimeout(()=>controller.abort(),190000);
    const closed=()=>{if(!res.writableFinished)controller.abort();};res.on('close',closed);
    try {
      if(req.method==='GET' && req.url==='/v1/models') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[{id:'qcode-model',object:'model',owned_by:'qcode'}]}));return;}
      if(req.method!=='POST' || req.url!=='/v1/chat/completions') {res.writeHead(404).end();return;}
      let length=0;const chunks=[];
      for await(const chunk of req){length+=chunk.length;if(length>4*1024*1024)throw Object.assign(new Error('请求超过 4 MB'),{status:413});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
      const config=await refreshConfig();
      for(const key of ['max_tokens','max_completion_tokens']) if(Number.isInteger(body[key]) && body[key]>config.maxOutputTokens)body[key]=config.maxOutputTokens;
      const response=await session.fetch('/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,model:config.model}),signal:controller.signal});
      res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type') || 'application/json');
      if(!response.body){res.end();return;}
      await pipeline(Readable.fromWeb(response.body),res);
    }catch(error){if(!res.headersSent&&!res.destroyed)res.writeHead(error.status||502,{'Content-Type':'application/json'}).end(JSON.stringify({error:{code:error.code||'GATEWAY_UNAVAILABLE',message:error.status ? error.message : '无法连接网关，请检查网络；请求未自动重发'}}));else res.destroy();}
    finally{clearTimeout(timeout);controllers.delete(controller);res.off('close',closed);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {token:localToken,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,configuration,refreshConfig,
    close:async()=>{for(const controller of controllers)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
