import { createApp, readConfig } from './app.js';
import { createDatabase, createVault } from './database.js';
let db;
try {
  const config = readConfig(process.env);
  db = createDatabase(config.dbPath, { vault: createVault(config.encryptionSecret) });
  const server = createApp(config, db).listen(config.port, config.host, () => console.log(`QCode Gateway: http://${config.host}:${config.port}`));
  server.on('error', error => { console.error(`Gateway failed to listen (${error.code || 'UNKNOWN'})`); db.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(() => { db.close(); process.exit(0); });
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); db.close(); process.exit(0); }, 5000).unref();
  });
} catch (error) { db?.close(); console.error(error.message); process.exitCode = 1; }
