// Compatibility entry point. Backups are now encrypted and do not copy the environment file.
process.argv.splice(2,0,'backup');
await import('./maintenance.js');
