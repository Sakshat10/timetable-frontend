import { buildApp } from '/Users/temp/Desktop/timetable-backend/src/app.ts';
const app = await buildApp({ env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' } });
await app.ready();
const cases: Array<[string,string,any,any?]> = [
  ['POST','/api/grades',{ academicYearId: 'not-a-uuid', name: 5, displayOrder: 'x' }],
  ['POST','/api/grades',{ academicYearId: '00000000-0000-4000-8000-000000000000', name: 'G', displayOrder: '3', extra: 1 }],
  ['POST','/api/subject-requirements',{ periodsPerWeek: '5' }],
  ['GET','/api/teachers?isActive=maybe',undefined],
  ['POST','/api/teacher-absences',{ teacherId: 1 }],
  ['GET','/api/timetable-versions?academicYearId=x',undefined],
  ['POST','/api/admin/logout',undefined],
  ['GET','/api/admin/me',undefined, { cookie: 'session_token=abc' }],
  ['OPTIONS','/api/teachers',undefined, { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' }],
  ['OPTIONS','/api/teachers',undefined, { origin: 'http://localhost:3001', 'access-control-request-method': 'POST' }],
];
for (const [method,url,payload,headers] of cases) {
  try {
    const r = await app.inject({ method: method as any, url, payload, headers });
    const h = Object.fromEntries(Object.entries(r.headers).filter(([k]) => /access-control|set-cookie|location/.test(k)));
    console.log(method, url, '->', r.statusCode, JSON.stringify(h), r.body.slice(0, 300));
  } catch (e) { console.log(method, url, 'THREW', (e as Error).message.slice(0,200)); }
}
await app.close(); process.exit(0);
