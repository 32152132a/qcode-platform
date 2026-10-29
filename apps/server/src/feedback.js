import { createHmac, timingSafeEqual } from "node:crypto";
import { id, now, fail, audit } from "./domain.js";

export const feedbackLimits = {
  characters: 1000,
  images: 3,
  imageBytes: 256 * 1024,
  daily: 5,
};
export const feedbackStatuses = [
  "pending",
  "accepted",
  "rejected",
  "completed",
];
const summary = ({ images, ...entry }) => ({
  ...entry,
  imageCount: images.length,
});

function screenshots(images = []) {
  if (!Array.isArray(images) || images.length > feedbackLimits.images)
    fail(400, "INVALID_SCREENSHOTS", "最多上传 3 张截图");
  return images.map((image) => {
    if (
      !image ||
      typeof image.name !== "string" ||
      image.name.length > 120 ||
      typeof image.dataUrl !== "string"
    )
      fail(400, "INVALID_SCREENSHOT", "截图格式不正确");
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        image.dataUrl,
      );
    if (
      !match ||
      match[2].length > Math.ceil(feedbackLimits.imageBytes / 3) * 4
    )
      fail(
        400,
        "INVALID_SCREENSHOT",
        "仅支持 PNG、JPEG、WebP，每张最多 256 KB",
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
      bytes.length > feedbackLimits.imageBytes ||
      bytes.toString("base64") !== match[2]
    )
      fail(400, "INVALID_SCREENSHOT", "截图内容或大小不正确");
    return { name: image.name, dataUrl: image.dataUrl };
  });
}
export function registerFeedback(app, { db, auth, config }) {
  const signature = (id, index, expires) =>
    createHmac("sha256", Buffer.from(config.encryptionSecret, "hex"))
      .update("feedback-image:" + id + ":" + index + ":" + expires)
      .digest("hex");
  function find(state, value) {
    const entry = state.feedback.find((item) => item.id === value);
    if (!entry) fail(404, "FEEDBACK_NOT_FOUND", "反馈不存在");
    return entry;
  }
  app.post("/client/feedback/list", auth, (req, res) =>
    res.json({
      feedback: db
        .read()
        .feedback.filter((item) => item.user_id === req.user.id)
        .map(summary)
        .reverse(),
      limits: feedbackLimits,
    }),
  );
  app.post("/client/feedback/create", auth, (req, res) => {
    const { content, submissionId, phone } = req.body || {};
    if (typeof phone !== "string" || !/^\+?[0-9]{7,20}$/.test(phone.trim()))
      fail(400, "INVALID_PHONE", "请填写有效的联系电话");
    if (
      typeof content !== "string" ||
      !content.trim() ||
      Array.from(content.trim()).length > feedbackLimits.characters ||
      content.includes("\0")
    )
      fail(400, "INVALID_FEEDBACK", "请填写问题描述，最多 1000 字");
    if (
      typeof submissionId !== "string" ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(submissionId)
    )
      fail(400, "INVALID_SUBMISSION", "提交编号不正确");
    const images = screenshots(req.body.images);
    const entry = db.transaction((state) => {
      const existing = state.feedback.find(
        (item) =>
          item.user_id === req.user.id && item.submission_id === submissionId,
      );
      if (existing) return existing;
      const timestamp = now();
      if (
        state.feedback.filter(
          (item) =>
            item.user_id === req.user.id &&
            item.created_at.slice(0, 10) === timestamp.slice(0, 10),
        ).length >= feedbackLimits.daily
      )
        fail(429, "FEEDBACK_LIMIT", "今日反馈已达上限，请明天再提交");
      const item = {
        id: id(),
        user_id: req.user.id,
        username: req.user.username,
        submission_id: submissionId,
        phone: phone.trim(),
        content: content.trim(),
        images,
        status: "pending",
        reply: "",
        created_at: timestamp,
        updated_at: timestamp,
      };
      state.feedback.push(item);
      return item;
    });
    res.status(201).json(summary(entry));
  });
  app.post("/admin/feedback/list", (_req, res) =>
    res.json(db.read().feedback.map(summary).reverse()),
  );
  app.post("/admin/feedback/:id/detail", (req, res) => {
    const entry = find(db.read(), req.params.id),
      expires = Date.now() + 15 * 60000;
    res.json({
      ...summary(entry),
      images: entry.images.map((image, index) => ({
        name: image.name,
        url:
          "/downloads/feedback/" +
          entry.id +
          "/" +
          index +
          "?expires=" +
          expires +
          "&signature=" +
          signature(entry.id, index, expires),
      })),
    });
  });
  // Short-lived capability URLs allow same-origin previews without exposing API tokens or changing CSP.
  app.get("/downloads/feedback/:id/:index", (req, res) => {
    const expires = Number(req.query.expires),
      supplied = String(req.query.signature || ""),
      index = Number(req.params.index);
    if (
      !Number.isSafeInteger(expires) ||
      expires < Date.now() ||
      expires > Date.now() + 16 * 60000 ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= feedbackLimits.images ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(
        Buffer.from(supplied, "hex"),
        Buffer.from(signature(req.params.id, index, expires), "hex"),
      )
    )
      fail(403, "IMAGE_LINK_EXPIRED", "截图链接已过期，请重新查看反馈");
    const image = find(db.read(), req.params.id).images[index];
    if (!image) fail(404, "IMAGE_NOT_FOUND", "截图不存在");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(
      image.dataUrl,
    );
    res
      .set({
        "Content-Type": match[1],
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      })
      .send(Buffer.from(match[2], "base64"));
  });
  app.post("/admin/feedback/:id/update", (req, res) =>
    res.json(
      db.transaction((state) => {
        const { status, reply = "" } = req.body || {};
        if (
          !feedbackStatuses.includes(status) ||
          typeof reply !== "string" ||
          Array.from(reply).length > 1000
        )
          fail(
            400,
            "INVALID_FEEDBACK_STATUS",
            "请选择处理状态，回复最多 1000 字",
          );
        const entry = find(state, req.params.id);
        Object.assign(entry, {
          status,
          reply: reply.trim(),
          updated_at: now(),
        });
        audit(state, req.user, "feedback.update", entry.id);
        return summary(entry);
      }),
    ),
  );
  app.post("/admin/feedback/:id/delete", (req, res) => {
    db.transaction((state) => {
      find(state, req.params.id);
      state.feedback = state.feedback.filter(
        (item) => item.id !== req.params.id,
      );
      audit(state, req.user, "feedback.delete", req.params.id);
    });
    res.json({ ok: true });
  });
}
