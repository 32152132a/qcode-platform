import { fail, period } from './domain.js';
export function filterRecords(records, query, timezone) {
  for(const key of ['from','to'])if(query[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(query[key])||!Number.isFinite(new Date(query[key]).getTime())||new Date(query[key]).toISOString().slice(0,10)!==query[key]))fail(400,'INVALID_DATE','日期格式应为 YYYY-MM-DD');
  if(query.from&&query.to&&query.from>query.to)fail(400,'INVALID_DATE','开始日期不能晚于结束日期');
  if(query.userId && !/^\d+$/.test(query.userId))fail(400,'INVALID_USER','用户 ID 无效');
  return records.filter(row=>{
    if(query.userId && row.user_id!==Number(query.userId))return false;
    if(query.status && row.status!==query.status)return false;
    if(query.search && ![row.username,row.actor,row.action,row.model,row.error_code].some(value=>String(value||'').toLowerCase().includes(String(query.search).toLowerCase())))return false;
    if(query.from||query.to){const day=period(row.started_at||row.time,timezone);if(query.from&&day<query.from)return false;if(query.to&&day>query.to)return false;}
    return true;
  });
}
export function csv(rows, columns) {
  const escape=value=>{
    let text=value==null?'':String(value);
    if(typeof value==='string' && /^[\s]*[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return '\uFEFF'+[columns.map(([label])=>escape(label)).join(','),...rows.map(row=>columns.map(([,key])=>escape(row[key])).join(','))].join('\r\n');
}
export function registerReports(app,{db,config}) {
  for(const type of ['requests','audits'])app.get(`/admin/${type}/export`,(req,res)=>{
    const rows=filterRecords(db.read()[type],req.query,config.timezone);
    if(rows.length>10000)fail(400,'EXPORT_TOO_LARGE','请缩小日期范围，每次最多导出一万条');
    const columns=type==='requests'?[['时间','started_at'],['用户','username'],['部门','department_name'],['模型','model'],['输入 Token','input_tokens'],['输出 Token','output_tokens'],['总 Token','total_tokens'],['计费 Token','charged_tokens'],['来源','usage_source'],['耗时 ms','duration_ms'],['状态','status'],['错误','error_code'],['费用（百万分之一货币单位）','cost_micros'],['币种','currency']]
      :[['时间','time'],['操作人','actor'],['动作','action'],['对象','target']];
    res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="qcode-${type}.csv"`}).send(csv(rows,columns));
  });
}
