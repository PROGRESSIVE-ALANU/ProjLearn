import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', '_headers', 'assets', 'data', 'src']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
console.log('Built ProjLearn 20260918j static assets; server code and environment files excluded.');
