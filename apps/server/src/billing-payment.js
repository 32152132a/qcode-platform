import { createHmac, timingSafeEqual } from "node:crypto";
import { id, now, fail, audit } from "./domain.js";

function validateImage(value) {
  const match =
    typeof value === "string" &&
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 700000)
    fail(
      400,
      "INVALID_PAYMENT_IMAGE",
      "收款码仅支持 PNG、JPEG、WebP，最大 512 KB",
    );
  const bytes = Buffer.from(match[2], "base64");
  const valid =
    match[1] === "png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (
    !valid ||
    bytes.length > 512 * 1024 ||
    bytes.toString("base64") !== match[2]
  )
    fail(400, "INVALID_PAYMENT_IMAGE", "收款码内容或大小不正确");
  return value;
}

export function registerBillingPayment(app, { db, config }) {
  const sign = (revision, expires) =>
    createHmac("sha256", Buffer.from(config.encryptionSecret, "hex"))
      .update("billing-qr:" + revision + ":" + expires)
      .digest("hex");
  function view(value) {
    if (!value)
      return { enabled: false, recipient: "", instructions: "", qrUrl: null };
    const expires = Date.now() + 15 * 60000;
    return {
      enabled: value.enabled,
      recipient: value.recipient,
      instructions: value.instructions,
      qrUrl: value.image
        ? "/downloads/billing-payment/" +
          value.revision +
          "?expires=" +
          expires +
          "&signature=" +
          sign(value.revision, expires)
        : null,
    };
  }
  function adminOnly(req) {
    if (req.user.role !== "admin")
      fail(403, "PERMISSION_DENIED", "仅管理员可以查看或配置收款资料");
  }
  // These routes precede /admin/plans/:id/update so payment config is never treated as a plan id.
  app.post("/admin/plans/payment-config/detail", (req, res) => {
    adminOnly(req);
    res.json(view(db.read().paymentSettings[0]));
  });
  app.post("/admin/plans/payment-config/update", (req, res) => {
    adminOnly(req);
    const saved = db.transaction((state) => {
      const body = req.body || {},
        previous = state.paymentSettings[0];
      if (
        typeof body.enabled !== "boolean" ||
        typeof body.recipient !== "string" ||
        body.recipient.trim().length > 80 ||
        typeof body.instructions !== "string" ||
        body.instructions.length > 500
      )
        fail(
          400,
          "INVALID_PAYMENT_SETTINGS",
          "请检查启用状态、收款人及付款说明（最多 500 字）",
        );
      const image =
        body.image === undefined
          ? previous?.image || null
          : body.image === null
            ? null
            : validateImage(body.image);
      if (body.enabled && (!image || !body.recipient.trim()))
        fail(
          400,
          "INVALID_PAYMENT_SETTINGS",
          "启用收款前请上传二维码并填写收款人",
        );
      const value = {
        id: "manual",
        enabled: body.enabled,
        recipient: body.recipient.trim(),
        instructions: body.instructions.trim(),
        image,
        revision: id(),
        updated_at: now(),
      };
      state.paymentSettings = [value];
      audit(state, req.user, "plan.payment_settings", value.revision);
      return value;
    });
    res.json(view(saved));
  });
  app.get("/downloads/billing-payment/:revision", (req, res) => {
    const expires = Number(req.query.expires),
      supplied = String(req.query.signature || ""),
      revision = req.params.revision;
    if (
      !Number.isSafeInteger(expires) ||
      expires < Date.now() ||
      expires > Date.now() + 16 * 60000 ||
      !/^[a-f0-9]{32}$/.test(revision) ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(
        Buffer.from(supplied, "hex"),
        Buffer.from(sign(revision, expires), "hex"),
      )
    )
      fail(403, "PAYMENT_IMAGE_EXPIRED", "收款码已过期，请刷新付款信息");
    const current = db.read().paymentSettings[0];
    if (!current?.image || current.revision !== revision)
      fail(410, "PAYMENT_IMAGE_CHANGED", "收款信息已变更，请刷新后重新核对");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(
      current.image,
    );
    res
      .set({
        "Content-Type": match[1],
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-store",
      })
      .send(Buffer.from(match[2], "base64"));
  });
  return (state, user) => {
    const current = state.paymentSettings[0];
    return user.role === "user" &&
      current?.enabled &&
      state.planOrders.some(
        (order) =>
          order.user_id === user.id &&
          order.status === "pending" &&
          order.terms.price_cents > 0,
      )
      ? view(current)
      : null;
  };
}
