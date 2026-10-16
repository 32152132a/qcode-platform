import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only page routes get the SPA shell; API and missing asset responses stay intact. */
export function registerWebPages(app, { directory = fileURLToPath(new URL('../public/console', import.meta.url)) } = {}) {
  app.use('/assets', express.static(path.join(directory, 'assets'), { index: false }));
  app.get(['/', '/download', '/login', /^\/manage(?:\/[^.]*)?$/, /^\/console(?:\/[^.]*)?$/], (_req, res, next) => {
    res.sendFile(path.join(directory, 'index.html'), error => {
      if (!error) return;
      if (error.code === 'ENOENT') {
        res.status(503).json({ error: { code: 'WEB_NOT_BUILT', message: '管理界面尚未构建，请先构建前端或使用 Docker 部署。' } });
      } else next(error);
    });
  });
  // Previously downloaded shells may still reference this asset prefix.
  app.use('/console/assets', express.static(path.join(directory, 'assets'), { index: false }));
}
