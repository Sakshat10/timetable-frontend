import { buildApp } from '/Users/temp/Desktop/timetable-backend/src/app.ts';
const out = process.argv[2]!;
const routes: string[] = [];
const app = await buildApp({ env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' } });
app.addHook; // noop
await app.ready();
const fs = await import('node:fs');
fs.writeFileSync(out + '/routes.txt', app.printRoutes({ commonPrefix: false, includeHooks: false, method: undefined as any }));
const res = await app.inject({ method: 'GET', url: '/docs/json' });
fs.writeFileSync(out + '/openapi.json', res.body);
await app.close();
process.exit(0);
