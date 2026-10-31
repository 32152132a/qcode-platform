import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only page routes get the SPA shell; API and missing asset responses stay intact. */
export function registerWebPages(app, { directory = fileURLToPath(new URL('../public/console', import.meta.url)) } = {}) {
  // Block the retired prefix even when public/console contains the current build.
  app.use('/console', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '页面不存在' } }));
  app.use('/assets', express.static(path.join(directory, 'assets'), { index: false }));
  const knownPage = /^(?:\/$|\/(?:download|login)$|\/manage(?:\/[^.]*)?$)/;
  const browserPage = /^\/(?!(?:console|admin|auth|client|downloads|assets|branding|api|v1|health)(?:\/|$))[^.]*$/;
  app.get([knownPage, browserPage], (req, res, next) => {
    if (!knownPage.test(req.path) && !req.get('accept')?.includes('text/html')) return next();
    res.sendFile(path.join(directory, 'index.html'), error => {
      if (!error) return;
      if (error.code === 'ENOENT') {
        res.status(503).json({ error: { code: 'WEB_NOT_BUILT', message: '管理界面尚未构建，请先构建前端或使用 Docker 部署。' } });
      } else next(error);
    });
  });
}
