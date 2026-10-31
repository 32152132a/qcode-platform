import { desktopInstaller, registerDesktopDistribution } from './desktop-distribution.js';
import { fileURLToPath } from 'node:url';
import { fail } from './domain.js';
export function registerDistribution(app, {directory = fileURLToPath(new URL('../releases/', import.meta.url))} = {}) {
  registerDesktopDistribution(app, directory);
  app.get('/downloads/installer', (_req, res) => {
    const desktop = desktopInstaller(directory);
    if (!desktop) fail(503, 'INSTALLER_NOT_PUBLISHED', 'Windows 安装包尚未发布，请联系管理员');
    res.setHeader('Cache-Control', 'no-store');
    res.download(desktop.filename, desktop.name);
  });
}
