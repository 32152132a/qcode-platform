function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const number = value => (value || 0).toLocaleString();
const rate = row => row.success + row.failed ? `${(100 * row.success / (row.success + row.failed)).toFixed(1)}%` : '暂无已结束请求';

export function renderUsage(data, { content, toolbar, filters, load, notice, table }) {
  const form = element('form', undefined, 'usage-filter');
  const inputs = {};
  for (const [key, title] of [['from', '开始日期'], ['to', '结束日期']]) {
    const label = element('label', title);
    const input = element('input'); input.type = 'date'; input.value = filters[key] || ''; input.setAttribute('aria-label', title);
    inputs[key] = input; label.append(input); form.append(label);
  }
  const apply = element('button', '应用日期'); apply.type = 'submit';
  const clear = element('button', '全部日期', 'secondary'); clear.type = 'button';
  form.onsubmit = event => {
    event.preventDefault();
    if (inputs.from.value && inputs.to.value && inputs.from.value > inputs.to.value) { notice(new Error('开始日期不能晚于结束日期')); return; }
    Object.assign(filters, { from: inputs.from.value, to: inputs.to.value }); load().catch(notice);
  };
  clear.onclick = () => { delete filters.from; delete filters.to; load().catch(notice); };
  form.append(apply, clear); toolbar.append(form);
  const root = element('div', undefined, 'usage-dashboard');
  root.append(element('p', '实际 Token：上游返回的用量。保守计费 Token：用量未知时按预留额度计费，并非实际消耗。计费 Token 合计包含两者；进行中请求暂占预留额度。成本按请求时管理员配置单价估算，并非上游账单，按币种分别展示。', 'usage-explanation'));
  const metrics = element('div', undefined, 'metrics');
  for (const [title, value] of [['请求数', number(data.totals.requests)], ['请求成功率', rate(data.totals)], ['实际 Token', number(data.totals.tokens)], ['保守计费 Token', number(data.totals.conservativeTokens)], ['计费 Token 合计', number(data.totals.chargedTokens)], ['未知用量请求', number(data.totals.unknownUsage)]]) {
    const metric = element('div', title, 'metric'); metric.append(element('strong', value)); metrics.append(metric);
  }
  root.append(metrics, element('p', `成功 ${number(data.totals.success)} · 失败/中断 ${number(data.totals.failed)} · 进行中 ${number(data.totals.pending)}。成功率 = 成功 / 已结束请求，排除进行中。`));
  const costs = Object.entries(data.totals.costs).map(([currency, amount]) => `${currency} ${amount.toFixed(6)}`).join(' · ');
  root.append(element('p', `估算成本（按币种独立）：${costs || '暂无可计算成本'}；${number(data.totals.unknownCost)} 个请求成本未知，未按零成本计算。`));
  if (!data.totals.requests) { root.append(element('div', '所选日期范围暂无请求，请调整日期筛选。', 'empty')); content.append(root); return; }
  const panels = element('div', undefined, 'usage-panels');
  const trend = element('section', undefined, 'usage-panel'); trend.append(element('h3', '每日 Token 趋势'));
  trend.append(element('p', '每行分别显示实际 Token 与保守计费 Token；无记录日期用量为 0。'));
  const chart = element('div', undefined, 'usage-trend');
  const days = new Map(data.days.map(day => [day.date, day]));
  const ordered = [...data.days].sort((a,b) => a.date.localeCompare(b.date));
  const start = filters.from || ordered[0].date, end = filters.to || ordered.at(-1).date;
  const count = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  // Bound DOM work for all-history reports while keeping the complete table below.
  const rows = count <= 366 ? Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(start) + index * 86400000).toISOString().slice(0,10);
    return days.get(date) || { date, tokens: 0, conservativeTokens: 0 };
  }) : ordered.slice(-366);
  if (count > 366) trend.append(element('p', '图表仅展示最近 366 个有记录日期，完整日期数据见下表。'));
  const max = Math.max(1, ...rows.flatMap(row => [row.tokens, row.conservativeTokens]));
  for (const day of rows) {
    const row = element('div', undefined, 'usage-day'); row.append(element('span', day.date));
    for (const [key, title] of [['tokens', '实际'], ['conservativeTokens', '保守计费']]) {
      const label = element('label', `${title} ${number(day[key])}`); const meter = element('meter'); meter.min = 0; meter.max = max; meter.value = day[key]; meter.setAttribute('aria-label', `${day.date} ${title} Token`); label.append(meter); row.append(label);
    }
    chart.append(row);
  }
  trend.append(chart); panels.append(trend);
  const distribution = element('section', undefined, 'usage-panel'); distribution.append(element('h3', '模型用量分布'), element('p', '占比按计费 Token 合计计算，包含保守计费。'));
  distribution.append(table(['模型', '实际 Token', '保守计费', '计费占比', '请求数'], data.models.map(model => [model.name, number(model.tokens), number(model.conservativeTokens), data.totals.chargedTokens ? `${(100 * model.chargedTokens / data.totals.chargedTokens).toFixed(1)}%` : '—', model.requests]))); panels.append(distribution);
  root.append(panels, element('h3', '用户用量排行（按计费 Token）'), table(['用户', '请求数', '实际 Token', '保守计费', '计费 Token', '成功率'], data.users.map(user => [user.username, user.requests, number(user.tokens), number(user.conservativeTokens), number(user.chargedTokens), rate(user)])), element('h3', '部门用量'), table(['部门', '请求数', '实际 Token', '计费 Token'], data.departments.map(row => [row.name, row.requests, number(row.tokens), number(row.chargedTokens)])), element('h3', '每日明细'), table(['日期', '请求数', '实际 Token', '保守计费', '计费 Token', '成功率'], data.days.map(day => [day.date, day.requests, number(day.tokens), number(day.conservativeTokens), number(day.chargedTokens), rate(day)])));
  content.append(root);
}
