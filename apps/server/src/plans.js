import {
  id,
  now,
  fail,
  audit,
  text,
  integer,
  quotas,
  publicUser,
} from "./domain.js";

const terms = (plan, state) => ({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  price_cents: plan.price_cents,
  currency: "CNY",
  duration_days: plan.duration_days,
  quotas: structuredClone(plan.quotas),
  model_ids: [...plan.model_ids],
  models: state.models
    .filter((model) => plan.model_ids.includes(model.id))
    .map((model) => ({ id: model.public_name, name: model.name })),
  max_concurrent_requests: plan.max_concurrent_requests,
});
function savePlan(state, body, existing) {
  const name = text(body.name, "套餐名称", 40);
  if (
    state.plans.some(
      (item) =>
        item.id !== existing?.id &&
        item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    fail(409, "PLAN_NAME_EXISTS", "套餐名称已存在");
  if (
    !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(body.price)) ||
    Number(body.price) > 1000000
  )
    fail(400, "INVALID_PRICE", "价格须为 0 至 1000000 元，最多两位小数");
  const days = integer(Number(body.durationDays), "有效天数", 366),
    concurrent = integer(Number(body.maxConcurrentRequests ?? 1), "并发数", 20);
  if (!days || !concurrent)
    fail(400, "INVALID_PLAN", "有效天数和并发数必须大于 0");
  if (
    !Array.isArray(body.modelIds) ||
    body.modelIds.length > 500 ||
    new Set(body.modelIds).size !== body.modelIds.length ||
    body.modelIds.some(
      (value) =>
        !state.models.some(
          (model) => model.id === value && model.model_type !== "image",
        ),
    )
  )
    fail(400, "INVALID_PLAN_MODELS", "请选择有效的对话模型");
  if (body.active !== undefined && typeof body.active !== "boolean")
    fail(400, "INVALID_PLAN", "上架状态必须为布尔值");
  if (
    body.description !== undefined &&
    (typeof body.description !== "string" || body.description.length > 400)
  )
    fail(400, "INVALID_PLAN", "说明最多 400 字");
  const plan = {
    id: existing?.id || id(),
    name,
    description: body.description?.trim() || "",
    price_cents: Math.round(Number(body.price) * 100),
    currency: "CNY",
    duration_days: days,
    model_ids: [...body.modelIds],
    quotas: quotas(body.quotas),
    max_concurrent_requests: concurrent,
    active: body.active ?? true,
    created_at: existing?.created_at || now(),
    updated_at: now(),
  };
  if (existing) Object.assign(existing, plan);
  else state.plans.push(plan);
  return plan;
}
export function registerPlans(app, { db, auth, config }) {
  const findPlan = (state, value) => {
    const plan = state.plans.find((item) => item.id === value);
    if (!plan) fail(404, "PLAN_NOT_FOUND", "套餐不存在");
    return plan;
  };
  const findOrder = (state, value) => {
    const order = state.planOrders.find((item) => item.id === value);
    if (!order) fail(404, "ORDER_NOT_FOUND", "申请不存在");
    return order;
  };
  const current = (state, userId) =>
    state.subscriptions.findLast((item) => item.user_id === userId);
  function grant(state, userId, snapshot, actor, orderId = null) {
    const user = state.users.find((item) => item.id === Number(userId));
    if (!user || user.role !== "user" || !user.is_active)
      fail(400, "INVALID_PLAN_USER", "只能为启用的普通用户开通套餐");
    const started = now();
    const entry = {
      id: id(),
      user_id: user.id,
      username: user.username,
      plan_id: snapshot.id,
      terms: structuredClone(snapshot),
      started_at: started,
      expires_at: new Date(
        Date.parse(started) + snapshot.duration_days * 86400000,
      ).toISOString(),
      order_id: orderId,
      created_by: actor.username,
    };
    state.subscriptions.push(entry);
    audit(state, actor, "plan.grant", entry.id);
    return entry;
  }
  app.post("/admin/plans/list", (_req, res) => res.json(db.read().plans));
  app.post("/admin/plans/create", (req, res) =>
    res.status(201).json(
      db.transaction((state) => {
        const plan = savePlan(state, req.body, null);
        audit(state, req.user, "plan.create", plan.id);
        return plan;
      }),
    ),
  );
  app.post("/admin/plans/:id/update", (req, res) =>
    res.json(
      db.transaction((state) => {
        const plan = savePlan(state, req.body, findPlan(state, req.params.id));
        audit(state, req.user, "plan.update", plan.id);
        return plan;
      }),
    ),
  );
  app.post("/admin/plans/:id/delete", (req, res) => {
    db.transaction((state) => {
      findPlan(state, req.params.id);
      if (
        state.subscriptions.some((item) => item.plan_id === req.params.id) ||
        state.planOrders.some((item) => item.plan_id === req.params.id)
      )
        fail(409, "PLAN_IN_USE", "套餐已有开通或申请记录，请改为下架");
      state.plans = state.plans.filter((item) => item.id !== req.params.id);
      audit(state, req.user, "plan.delete", req.params.id);
    });
    res.json({ ok: true });
  });
  app.post("/admin/plans/orders/list", (req, res) => {
    if (req.user.role === "demo")
      fail(403, "PERMISSION_DENIED", "演示账号不能查看开通申请");
    res.json(db.read().planOrders.toReversed());
  });
  app.post("/admin/plans/members/list", (req, res) => {
    if (req.user.role === "demo")
      fail(403, "PERMISSION_DENIED", "演示账号不能查看套餐成员");
    const state = db.read();
    res.json(
      state.users.flatMap((user) => {
        const entry = current(state, user.id);
        return entry
          ? [
              {
                ...entry,
                status: entry.expires_at > now() ? "active" : "expired",
              },
            ]
          : [];
      }),
    );
  });
  app.post("/admin/plans/grants/create", (req, res) =>
    res.status(201).json(
      db.transaction((state) => {
        if (req.body.confirmed !== true)
          fail(400, "CONFIRMATION_REQUIRED", "请确认已核对开通信息");
        const plan = findPlan(state, req.body.planId);
        if (!plan.active) fail(409, "PLAN_UNAVAILABLE", "套餐已下架");
        return grant(state, req.body.userId, terms(plan, state), req.user);
      }),
    ),
  );
  app.post("/admin/plans/orders/:id/approve", (req, res) =>
    res.json(
      db.transaction((state) => {
        const order = findOrder(state, req.params.id);
        if (order.status === "approved")
          return state.subscriptions.find((item) => item.order_id === order.id);
        if (order.status !== "pending")
          fail(409, "ORDER_PROCESSED", "申请已处理");
        if (req.body.confirmed !== true)
          fail(400, "CONFIRMATION_REQUIRED", "请先核对实际收款或免费开通信息");
        if (!findPlan(state, order.plan_id).active)
          fail(409, "PLAN_UNAVAILABLE", "套餐已下架，请拒绝申请后重新选择");
        const entry = grant(
          state,
          order.user_id,
          order.terms,
          req.user,
          order.id,
        );
        Object.assign(order, {
          status: "approved",
          processed_at: now(),
          processed_by: req.user.username,
        });
        return entry;
      }),
    ),
  );
  app.post("/admin/plans/orders/:id/reject", (req, res) =>
    res.json(
      db.transaction((state) => {
        const order = findOrder(state, req.params.id);
        if (order.status !== "pending")
          fail(409, "ORDER_PROCESSED", "申请已处理");
        if (
          typeof req.body.reply !== "string" ||
          !req.body.reply.trim() ||
          req.body.reply.length > 500
        )
          fail(400, "INVALID_REPLY", "请填写拒绝原因，最多 500 字");
        Object.assign(order, {
          status: "rejected",
          reply: req.body.reply.trim(),
          processed_at: now(),
          processed_by: req.user.username,
        });
        audit(state, req.user, "plan.reject", order.id);
        return order;
      }),
    ),
  );
  app.post("/client/billing/detail", auth, (req, res) => {
    const state = db.read(),
      subscription = current(state, req.user.id);
    const account = publicUser(state, req.user, config.timezone);
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
      },
      status: subscription
        ? subscription.expires_at > now()
          ? "active"
          : "expired"
        : "none",
      subscription: subscription || null,
      plans: state.plans
        .filter((plan) => plan.active)
        .map((plan) => terms(plan, state)),
      orders: state.planOrders
        .filter((item) => item.user_id === req.user.id)
        .toReversed(),
      usage: {
        used: account.used,
        remaining: account.remaining,
        effective_quotas: account.effective_quotas,
      },
      paymentMode: "manual",
    });
  });
  app.post("/client/billing/apply", auth, (req, res) =>
    res.status(201).json(
      db.transaction((state) => {
        if (req.user.role !== "user")
          fail(403, "INVALID_PLAN_USER", "请使用普通员工账号申请套餐");
        const plan = findPlan(state, req.body.planId);
        if (!plan.active) fail(409, "PLAN_UNAVAILABLE", "套餐已下架");
        const pending = state.planOrders.find(
          (item) =>
            item.user_id === req.user.id &&
            item.plan_id === plan.id &&
            item.status === "pending",
        );
        if (pending) return pending;
        if (
          typeof req.body.phone !== "string" ||
          !/^\+?[0-9]{7,20}$/.test(req.body.phone.trim())
        )
          fail(400, "INVALID_PHONE", "请填写有效的联系电话");
        if (
          state.planOrders.filter(
            (item) => item.user_id === req.user.id && item.status === "pending",
          ).length >= 3
        )
          fail(429, "ORDER_LIMIT", "最多保留 3 条待处理申请");
        if (
          state.planOrders.filter(
            (item) =>
              item.user_id === req.user.id &&
              item.created_at.slice(0, 10) === now().slice(0, 10),
          ).length >= 10
        )
          fail(429, "ORDER_LIMIT", "今日申请已达上限");
        const order = {
          id: id(),
          user_id: req.user.id,
          username: req.user.username,
          phone: req.body.phone.trim(),
          plan_id: plan.id,
          terms: terms(plan, state),
          status: "pending",
          reply: "",
          created_at: now(),
        };
        state.planOrders.push(order);
        return order;
      }),
    ),
  );
  app.post("/client/billing/:id/cancel", auth, (req, res) => {
    db.transaction((state) => {
      const order = findOrder(state, req.params.id);
      if (order.user_id !== req.user.id)
        fail(404, "ORDER_NOT_FOUND", "申请不存在");
      if (order.status !== "pending")
        fail(409, "ORDER_PROCESSED", "申请已处理");
      order.status = "cancelled";
      order.processed_at = now();
    });
    res.json({ ok: true });
  });
}
