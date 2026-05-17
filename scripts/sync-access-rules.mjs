// _remote/scripts/sync-access-rules.mjs
// Sincroniza rules JSON pra dentro do bundle web (fonte única continua em src/services).
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../src/services/la-report-access-rules.json');
const dest = resolve(__dirname, '../web/src/lib/access-rules.json');
copyFileSync(src, dest);
console.log(`[sync-access-rules] ${src} → ${dest}`);
