# TOM Video Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline Remotion que produz vídeos de demo 9:16 (1080×1920, 30fps) com narração ElevenLabs na voz do TOM, sincronizada por cena; piloto = vídeo "Grupos de Tarefas" (7 cenas, ~55s).

**Architecture:** Projeto Remotion independente em `D:\la-organizer\video-studio` (FORA do `_remote`, fora de git/deploy). Réplicas visuais do DS do PWA (Tailwind 3.4, tokens dark hard-coded), cursor sintético + digitação por frame, áudio gerado ANTES por script (cache por hash do texto) e `calculateMetadata` mede cada MP3 pra dimensionar as cenas — o áudio dita o tempo.

**Tech Stack:** Remotion 4 (@remotion/cli, @remotion/tailwind, @remotion/media-utils, @remotion/google-fonts), React 18.3, Tailwind 3.4, TypeScript, vitest, tsx, ElevenLabs API (voz `xtPlXcRNvdlUVw2QsITM`).

**Regras do projeto que se aplicam aqui:**
- SEM steps de commit: `video-studio` está fora de git; a spec/plano em `_remote/docs` são commitados pelo auto-deploy hook no fim do turno (CLAUDE.md: não commitar entre tasks).
- `ssh tom "..."` é sempre permitido (chave ElevenLabs vem da VPS).
- Narração 100% PT-BR.
- Spec: `docs/superpowers/specs/2026-06-10-video-studio-design.md`.

---

## Mapa de arquivos

```
D:\la-organizer\video-studio\
  package.json, tsconfig.json, remotion.config.ts, tailwind.config.js, postcss.config.js
  .gitignore, .env (gerado)
  public/brand/  public/audio/grupos-de-tarefas/
  src/index.ts, src/Root.tsx, src/style.css
  src/lib/timing.ts, Cursor.tsx, Camera.tsx, useTypewriter.ts, narration.tsx
  src/ds/PhoneFrame.tsx, Checkbox.tsx, Pill.tsx, ProgressBar.tsx, KindButtonMock.tsx,
        SheetMock.tsx, DayPickerMock.tsx, WhatsAppChat.tsx
  src/scenes/Intro.tsx, Outro.tsx
  src/videos/grupos-de-tarefas/roteiro.ts, GruposVideo.tsx, cenas/*.tsx
  scripts/setup-env.mjs, narration-lib.mjs, gen-narration.mjs
  tests/timing.test.ts, narration-lib.test.mjs
  out/
```

---

### Task 1: Scaffold do projeto

**Files:**
- Create: `D:\la-organizer\video-studio\package.json`
- Create: `D:\la-organizer\video-studio\tsconfig.json`
- Create: `D:\la-organizer\video-studio\remotion.config.ts`
- Create: `D:\la-organizer\video-studio\postcss.config.js`
- Create: `D:\la-organizer\video-studio\.gitignore`
- Create: `D:\la-organizer\video-studio\src\index.ts`
- Create: `D:\la-organizer\video-studio\src\style.css`

- [ ] **Step 1: Criar pastas**

```powershell
New-Item -ItemType Directory -Force D:\la-organizer\video-studio\src\lib, D:\la-organizer\video-studio\src\ds, D:\la-organizer\video-studio\src\scenes, D:\la-organizer\video-studio\src\videos\grupos-de-tarefas\cenas, D:\la-organizer\video-studio\scripts, D:\la-organizer\video-studio\tests, D:\la-organizer\video-studio\public\brand, D:\la-organizer\video-studio\public\audio, D:\la-organizer\video-studio\out
```

- [ ] **Step 2: package.json**

```json
{
  "name": "tom-video-studio",
  "private": true,
  "scripts": {
    "studio": "remotion studio",
    "render": "remotion render",
    "narration": "node scripts/gen-narration.mjs",
    "setup-env": "node scripts/setup-env.mjs",
    "test": "vitest run",
    "tsc": "tsc --noEmit"
  },
  "dependencies": {
    "@remotion/cli": "^4.0.0",
    "@remotion/google-fonts": "^4.0.0",
    "@remotion/media-utils": "^4.0.0",
    "@remotion/tailwind": "^4.0.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "remotion": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "3.4.14",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["DOM", "ES2022"],
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: remotion.config.ts + postcss.config.js + style.css + index.ts + .gitignore**

`remotion.config.ts`:
```ts
import { Config } from '@remotion/cli/config';
import { enableTailwind } from '@remotion/tailwind';

Config.overrideWebpackConfig((currentConfiguration) => enableTailwind(currentConfiguration));
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
```

`postcss.config.js`:
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`src/style.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`src/index.ts`:
```ts
import { registerRoot } from 'remotion';
import { Root } from './Root';

registerRoot(Root);
```

`.gitignore`:
```
node_modules/
out/
.env
public/audio/
```

- [ ] **Step 5: Root.tsx placeholder mínimo** (substituído na Task 10)

`src/Root.tsx`:
```tsx
import './style.css';
import { Composition, AbsoluteFill } from 'remotion';

const Placeholder: React.FC = () => (
  <AbsoluteFill className="bg-bg-app items-center justify-center">
    <div className="text-tom text-h2-brand font-sans">TOM Video Studio</div>
  </AbsoluteFill>
);

export const Root: React.FC = () => (
  <Composition id="placeholder" component={Placeholder} durationInFrames={30} fps={30} width={1080} height={1920} />
);
```

- [ ] **Step 6: Instalar**

Run: `cd D:\la-organizer\video-studio; npm install`
Expected: instala sem erros (Remotion 4.x resolve as versões `^4.0.0` pra mesma minor).

- [ ] **Step 7: Verificar** — só depois da Task 3 o Tailwind compila (tailwind.config.js ainda não existe); aqui basta: `npx tsc --noEmit` → sem erros.

---

### Task 2: setup-env.mjs + assets de marca

**Files:**
- Create: `D:\la-organizer\video-studio\scripts\setup-env.mjs`

- [ ] **Step 1: Escrever o script**

```js
// setup-env.mjs — puxa as credenciais ElevenLabs do .env da VPS (ssh tom)
// e copia os assets de marca do PWA. Roda 1x por máquina (ou quando a chave girar).
import { execSync } from 'node:child_process';
import { writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 1) Credenciais da VPS
const out = execSync('ssh tom "grep \'^ELEVENLABS\' /opt/LA-Organizer/.env"', { encoding: 'utf-8' });
if (!out.includes('ELEVENLABS_API_KEY=')) {
  console.error('ELEVENLABS_API_KEY não encontrada na VPS'); process.exit(1);
}
writeFileSync(resolve(root, '.env'), out.trim() + '\n', 'utf-8');
console.log('.env escrito com', out.trim().split('\n').length, 'linhas ELEVENLABS_*');

// 2) Assets de marca do PWA
const pub = 'D:/la-organizer/_remote/web/public';
mkdirSync(resolve(root, 'public/brand'), { recursive: true });
for (const f of ['Avata-Tom.png', 'logo-la-music-dark-solo.svg', 'logo-la-music-dark-completa.svg']) {
  copyFileSync(resolve(pub, f), resolve(root, 'public/brand', f));
  console.log('copiado:', f);
}
```

- [ ] **Step 2: Rodar e verificar**

Run: `cd D:\la-organizer\video-studio; node scripts/setup-env.mjs`
Expected: `.env escrito com 2 linhas` + 3 `copiado:`. Conferir: `Get-Content .env` mostra `ELEVENLABS_API_KEY=...` (NÃO imprimir no relatório).

---

### Task 3: Tokens do DS (tailwind.config.js + fontes)

**Files:**
- Create: `D:\la-organizer\video-studio\tailwind.config.js`
- Create: `D:\la-organizer\video-studio\src\lib\fonts.ts`

- [ ] **Step 1: tailwind.config.js** — valores REAIS do PWA (dark fixo; vídeo é sempre dark):

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      display: ['"Instrument Serif"', 'Georgia', 'serif'],
    },
    extend: {
      colors: {
        brand: { DEFAULT: '#E91451', shade: '#B01545', deep: '#740A28', light: '#F06292', dark: '#373435' },
        tom: { DEFAULT: '#A3BE50', shade: '#8BA244', deep: '#728538', light: '#BAD179', tint: '#E8F0CF' },
        success: '#22C55E', warning: '#F59E0B', danger: '#EF4444', info: '#3B82F6',
        // Tokens dark do PWA resolvidos (índex.css :root dark):
        bg: { app: '#0A0A0A', surface: '#141414', elevated: '#1A1A1A', subtle: '#1E1E1E' },
        fg: { DEFAULT: '#FFFFFF', secondary: '#CFCFCF', muted: '#9E9E9E' },
        border: { DEFAULT: '#2A2A2A' },
        wa: { bg: '#0B141A', in: '#1F2C34', out: '#005C4B' }, // WhatsApp dark
      },
      fontSize: {
        'screen-title': ['1.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        'card-title': ['1.125rem', { lineHeight: '1.3', fontWeight: '600' }],
        'body-lg': ['1rem', { lineHeight: '1.5', fontWeight: '500' }],
        'body-md': ['0.9375rem', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.45', fontWeight: '400' }],
        'label': ['0.75rem', { lineHeight: '1.2', fontWeight: '700' }],
        'h2-brand': ['2.5rem', { lineHeight: '1.05', fontWeight: '900' }],
      },
      borderRadius: { sm: '10px', md: '16px', lg: '20px' },
      boxShadow: { soft: '0 6px 20px rgba(0,0,0,0.22)' },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: fontes** — `src/lib/fonts.ts`:

```ts
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif';

loadInter();
loadSerif();
```

E em `src/Root.tsx`, adicionar `import './lib/fonts';` no topo.

- [ ] **Step 3: Verificar no Studio**

Run: `cd D:\la-organizer\video-studio; npx remotion studio` (background)
Expected: abre em http://localhost:3000, composição `placeholder` mostra fundo `#0A0A0A` e texto "TOM Video Studio" verde `#A3BE50`. Validar via screenshot/preview e derrubar o processo.

---

### Task 4: lib/timing.ts (TDD)

**Files:**
- Test: `tests/timing.test.ts`
- Create: `src/lib/timing.ts`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { FPS, sec, sceneDuration, sceneStarts } from '../src/lib/timing';

describe('timing', () => {
  it('sec converte segundos em frames inteiros a 30fps', () => {
    expect(FPS).toBe(30);
    expect(sec(1)).toBe(30);
    expect(sec(0.8)).toBe(24);
    expect(sec(4.21)).toBe(127); // round, não floor
  });
  it('sceneDuration = max(min, áudio + respiro 0.8s)', () => {
    expect(sceneDuration(3.0, 4)).toBe(sec(4));      // áudio curto → vale o mínimo
    expect(sceneDuration(5.5, 4)).toBe(sec(6.3));    // 5.5 + 0.8
    expect(sceneDuration(null, 4)).toBe(sec(4));     // sem áudio → mínimo
  });
  it('sceneStarts acumula offsets', () => {
    expect(sceneStarts([120, 180, 90])).toEqual([0, 120, 300]);
  });
});
```

Run: `npx vitest run tests/timing.test.ts` → Expected: FAIL (módulo não existe).

- [ ] **Step 2: Implementar `src/lib/timing.ts`**

```ts
// O áudio dita o tempo: cada cena dura o áudio + respiro, nunca menos que o mínimo do roteiro.
export const FPS = 30;
export const SCENE_PADDING_S = 0.8;

export function sec(s: number): number {
  return Math.round(s * FPS);
}

export function sceneDuration(audioSeconds: number | null, minSeconds: number): number {
  if (audioSeconds == null) return sec(minSeconds);
  return Math.max(sec(minSeconds), sec(audioSeconds + SCENE_PADDING_S));
}

export function sceneStarts(durations: number[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const d of durations) { starts.push(acc); acc += d; }
  return starts;
}
```

- [ ] **Step 3: Rodar** → `npx vitest run tests/timing.test.ts` → PASS (3 testes).

---

### Task 5: Narração — cache lib (TDD) + gen-narration.mjs

**Files:**
- Test: `tests/narration-lib.test.mjs`
- Create: `scripts/narration-lib.mjs`
- Create: `scripts/gen-narration.mjs`

- [ ] **Step 1: Teste que falha**

```js
import { describe, it, expect } from 'vitest';
import { hashText, audioFileName, planFiles } from '../scripts/narration-lib.mjs';

describe('narration-lib', () => {
  it('hashText é estável e tem 8 chars hex', () => {
    expect(hashText('olá')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText('olá')).toBe(hashText('olá'));
    expect(hashText('olá')).not.toBe(hashText('ola'));
  });
  it('audioFileName embute id e hash', () => {
    const h = hashText('texto');
    expect(audioFileName('intro', 'texto')).toBe(`intro.${h}.mp3`);
  });
  it('planFiles separa o que gerar, manter e apagar', () => {
    const cenas = [{ id: 'a', narracao: 'x' }, { id: 'b', narracao: 'y' }];
    const aName = audioFileName('a', 'x');
    const existing = [aName, 'b.deadbeef.mp3', 'velho.123.mp3'];
    const plan = planFiles(cenas, existing);
    expect(plan.keep).toEqual([aName]);                       // a: hash bate → mantém
    expect(plan.generate.map(g => g.id)).toEqual(['b']);      // b: texto mudou → regenera
    expect(plan.stale.sort()).toEqual(['b.deadbeef.mp3', 'velho.123.mp3']); // lixo some
  });
});
```

Run: `npx vitest run tests/narration-lib.test.mjs` → FAIL.

- [ ] **Step 2: `scripts/narration-lib.mjs`**

```js
// Funções puras do cache de narração (testáveis sem rede).
import { createHash } from 'node:crypto';

export function hashText(text) {
  return createHash('sha1').update(String(text), 'utf-8').digest('hex').slice(0, 8);
}

export function audioFileName(sceneId, text) {
  return `${sceneId}.${hashText(text)}.mp3`;
}

/** cenas: [{id, narracao}] · existing: nomes .mp3 no diretório.
 *  → {keep: string[], generate: [{id, narracao, file}], stale: string[]} */
export function planFiles(cenas, existing) {
  const wanted = new Map(cenas.map(c => [audioFileName(c.id, c.narracao), c]));
  const keep = existing.filter(f => wanted.has(f));
  const keepSet = new Set(keep);
  const generate = [...wanted.entries()]
    .filter(([file]) => !keepSet.has(file))
    .map(([file, c]) => ({ id: c.id, narracao: c.narracao, file }));
  const stale = existing.filter(f => !wanted.has(f));
  return { keep, generate, stale };
}
```

Run: `npx vitest run tests/narration-lib.test.mjs` → PASS (3 testes).

- [ ] **Step 3: `scripts/gen-narration.mjs`** (rede; sem teste unitário — validação na Task 12)

```js
// Gera narração ElevenLabs por cena com cache por hash.
// Uso: node scripts/gen-narration.mjs grupos-de-tarefas
// Lê src/videos/<id>/roteiro.ts via tsx; escreve public/audio/<id>/*.mp3 + manifest.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { planFiles, audioFileName } from './narration-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const videoId = process.argv[2];
if (!videoId) { console.error('uso: node scripts/gen-narration.mjs <video-id>'); process.exit(1); }

// .env manual (sem dotenv): KEY=valor por linha
for (const line of readFileSync(resolve(root, '.env'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) { console.error('rode antes: npm run setup-env'); process.exit(1); }

const VOICE_ID = 'xtPlXcRNvdlUVw2QsITM'; // voz real do TOM (decisão Alf 10/06)
const MODEL_ID = 'eleven_multilingual_v2';

// roteiro.ts é TS → transpila com tsx pra um mjs temporário e importa
const roteiroTs = resolve(root, 'src', 'videos', videoId, 'roteiro.ts');
execSync(`npx tsx --eval "import('${pathToFileURL(roteiroTs).href.replace(/'/g, "\\'")}').then(m => require('node:fs').writeFileSync('${resolve(root, 'out', 'roteiro-tmp.json').replace(/\\/g, '/')}', JSON.stringify(m.ROTEIRO)))"`, { cwd: root, stdio: 'inherit' });
const cenas = JSON.parse(readFileSync(resolve(root, 'out', 'roteiro-tmp.json'), 'utf-8'));

const audioDir = resolve(root, 'public', 'audio', videoId);
mkdirSync(audioDir, { recursive: true });
const existing = existsSync(audioDir) ? readdirSync(audioDir).filter(f => f.endsWith('.mp3')) : [];
const plan = planFiles(cenas, existing);

console.log(`cache: ${plan.keep.length} mantidos · ${plan.generate.length} a gerar · ${plan.stale.length} obsoletos`);
for (const f of plan.stale) unlinkSync(resolve(audioDir, f));

for (const g of plan.generate) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text: g.narracao,
      model_id: MODEL_ID,
      // Derivado do tts.js do TOM; speed mais calmo pra narração (spec §voice settings)
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true, speed: 1.05 },
    }),
  });
  if (!res.ok) { console.error(`ElevenLabs HTTP ${res.status} na cena ${g.id}:`, (await res.text()).slice(0, 200)); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(audioDir, g.file), buf);
  console.log(`gerado: ${g.file} (${(buf.length / 1024).toFixed(0)} KB)`);
}

// manifest: {sceneId: fileName} — o Remotion (browser) não lista diretório
const manifest = Object.fromEntries(cenas.map(c => [c.id, audioFileName(c.id, c.narracao)]));
writeFileSync(resolve(audioDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('manifest.json escrito com', Object.keys(manifest).length, 'cenas');
```

- [ ] **Step 4: Verificar sintaxe** → `node --check scripts/gen-narration.mjs` → sem erro. (Execução real na Task 12, quando o roteiro existir.)

---

### Task 6: lib/Cursor.tsx + Camera.tsx + useTypewriter.ts

**Files:**
- Create: `src/lib/Cursor.tsx`
- Create: `src/lib/Camera.tsx`
- Create: `src/lib/useTypewriter.ts`

- [ ] **Step 1: `src/lib/Cursor.tsx`**

```tsx
// Cursor sintético: bolinha translúcida que viaja por keyframes com easing suave
// e solta um "ripple" nos cliques. Coordenadas no espaço do pai (position:relative).
import { interpolate, useCurrentFrame, Easing } from 'remotion';

export type CursorKeyframe = { frame: number; x: number; y: number; click?: boolean };

export const Cursor: React.FC<{ keyframes: CursorKeyframe[]; size?: number }> = ({ keyframes, size = 34 }) => {
  const frame = useCurrentFrame();
  if (keyframes.length < 2) return null;
  const frames = keyframes.map(k => k.frame);
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) } as const;
  const x = interpolate(frame, frames, keyframes.map(k => k.x), opts);
  const y = interpolate(frame, frames, keyframes.map(k => k.y), opts);
  // "Pressiona" levemente no clique
  const clicks = keyframes.filter(k => k.click);
  const nearClick = clicks.find(k => frame >= k.frame && frame <= k.frame + 12);
  const press = nearClick ? interpolate(frame - nearClick.frame, [0, 4, 12], [1, 0.82, 1]) : 1;
  return (
    <>
      {clicks.map(k => {
        if (frame < k.frame || frame > k.frame + 16) return null;
        const t = (frame - k.frame) / 16;
        return (
          <div key={k.frame} style={{
            position: 'absolute', left: k.x, top: k.y, width: size * (1 + t * 1.6), height: size * (1 + t * 1.6),
            transform: 'translate(-50%, -50%)', borderRadius: '50%',
            border: '3px solid rgba(163,190,80,0.9)', opacity: 1 - t,
          }} />
        );
      })}
      <div style={{
        position: 'absolute', left: x, top: y, width: size, height: size,
        transform: `translate(-50%, -50%) scale(${press})`, borderRadius: '50%',
        background: 'rgba(255,255,255,0.35)', border: '2.5px solid rgba(255,255,255,0.85)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.45)', zIndex: 50,
      }} />
    </>
  );
};
```

- [ ] **Step 2: `src/lib/Camera.tsx`**

```tsx
// Zoom/pan de "câmera": escala e desloca o conteúdo entre dois enquadramentos.
import { interpolate, useCurrentFrame, Easing } from 'remotion';

type Frame = { scale: number; x: number; y: number };

export const Camera: React.FC<{
  from: Frame; to: Frame; startFrame: number; endFrame: number; children: React.ReactNode;
}> = ({ from, to, startFrame, endFrame, children }) => {
  const frame = useCurrentFrame();
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) } as const;
  const scale = interpolate(frame, [startFrame, endFrame], [from.scale, to.scale], opts);
  const x = interpolate(frame, [startFrame, endFrame], [from.x, to.x], opts);
  const y = interpolate(frame, [startFrame, endFrame], [from.y, to.y], opts);
  return (
    <div style={{ width: '100%', height: '100%', transform: `scale(${scale}) translate(${x}px, ${y}px)` }}>
      {children}
    </div>
  );
};
```

- [ ] **Step 3: `src/lib/useTypewriter.ts`**

```ts
// Digitação letra-a-letra dirigida pelo frame (determinística pro render).
import { useCurrentFrame } from 'remotion';
import { FPS } from './timing';

export function useTypewriter(text: string, startFrame: number, cps = 14) {
  const frame = useCurrentFrame();
  const chars = Math.max(0, Math.floor(((frame - startFrame) / FPS) * cps));
  const shown = text.slice(0, Math.min(chars, text.length));
  return { shown, done: chars >= text.length, caretOn: Math.floor(frame / 8) % 2 === 0 };
}
```

- [ ] **Step 4: Verificar** → `npx tsc --noEmit` → sem erros.

---

### Task 7: Réplicas DS — parte 1 (PhoneFrame, Checkbox, Pill, ProgressBar)

**Files:**
- Create: `src/ds/PhoneFrame.tsx`, `src/ds/Checkbox.tsx`, `src/ds/Pill.tsx`, `src/ds/ProgressBar.tsx`

- [ ] **Step 1: `src/ds/PhoneFrame.tsx`**

```tsx
// Moldura de celular flutuante (tela lógica 390×844, escalada pro quadro 1080×1920).
// Réplica otimizada pra vídeo — não é pixel-perfect do app (spec: "irmão gêmeo").
import { AbsoluteFill } from 'remotion';

export const PhoneFrame: React.FC<{ children: React.ReactNode; scale?: number }> = ({ children, scale = 2.05 }) => (
  <AbsoluteFill className="items-center justify-center">
    <div style={{ transform: `scale(${scale})` }}>
      <div className="relative w-[390px] h-[844px] rounded-[52px] bg-bg-app overflow-hidden shadow-soft"
           style={{ border: '10px solid #2A2A2A', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
        {/* notch pill */}
        <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[120px] h-[26px] rounded-full bg-black z-40" />
        <div className="absolute inset-0 pt-[44px]">{children}</div>
      </div>
    </div>
  </AbsoluteFill>
);
```

- [ ] **Step 2: `src/ds/Checkbox.tsx`**

```tsx
// Réplica do TaskCheckbox: círculo que enche de verde com check.
export const Checkbox: React.FC<{ checked: boolean; size?: number }> = ({ checked, size = 22 }) => (
  <div style={{ width: size, height: size }}
       className={`rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${
         checked ? 'bg-tom border-tom' : 'border-fg-muted bg-transparent'}`}>
    {checked && (
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#0A0A0A" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </div>
);
```

- [ ] **Step 3: `src/ds/Pill.tsx`**

```tsx
// Réplica das pills de input (DayOfMonthInput/TimeInput fechadas) e chips de lembrete.
export const Pill: React.FC<{
  icon?: React.ReactNode; label: string; active?: boolean; muted?: boolean;
}> = ({ icon, label, active, muted }) => (
  <div className={`h-9 px-3 rounded-md border inline-flex items-center gap-2 text-body-md font-sans ${
    active ? 'bg-tom text-black border-tom font-semibold'
           : `bg-bg-elevated border-border ${muted ? 'text-fg-muted' : 'text-fg'}`}`}>
    {icon}<span style={{ whiteSpace: 'nowrap' }}>{label}</span>
  </div>
);
```

- [ ] **Step 4: `src/ds/ProgressBar.tsx`**

```tsx
// Barra de progresso do card de grupo (h-1, fill verde tom).
export const ProgressBar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="h-1 w-full rounded-full bg-border overflow-hidden">
    <div className="h-full bg-tom rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
  </div>
);
```

- [ ] **Step 5: Verificar** → `npx tsc --noEmit` → sem erros.

---

### Task 8: Réplicas DS — parte 2 (KindButtonMock, SheetMock, DayPickerMock, WhatsAppChat)

**Files:**
- Create: `src/ds/KindButtonMock.tsx`, `src/ds/SheetMock.tsx`, `src/ds/DayPickerMock.tsx`, `src/ds/WhatsAppChat.tsx`

- [ ] **Step 1: `src/ds/KindButtonMock.tsx`** (cards Tarefa/Compromisso/Delegar/Grupo do QuickCreate)

```tsx
export const KindButtonMock: React.FC<{ icon: string; label: string; hint: string; selected?: boolean }> =
  ({ icon, label, hint, selected }) => (
  <div className={`flex flex-col items-center justify-center gap-1 rounded-md border px-1 py-3 ${
    selected ? 'border-tom bg-tom/10' : 'border-border bg-bg-elevated'}`}>
    <span style={{ fontSize: 18 }}>{icon}</span>
    <span className={`text-[11px] font-semibold ${selected ? 'text-tom' : 'text-fg'}`}>{label}</span>
    <span className="text-[9.5px] text-fg-muted">{hint}</span>
  </div>
);
```

- [ ] **Step 2: `src/ds/SheetMock.tsx`** (BottomSheet com handle)

```tsx
export const SheetMock: React.FC<{ title: string; children: React.ReactNode; heightPct?: number }> =
  ({ title, children, heightPct = 78 }) => (
  <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-bg-surface border-t border-border z-30"
       style={{ height: `${heightPct}%` }}>
    <div className="w-10 h-1 rounded-full bg-border mx-auto mt-2" />
    <div className="px-4 pt-3 pb-2 text-screen-title text-fg font-sans">{title}</div>
    <div className="px-4 pb-4">{children}</div>
  </div>
);
```

- [ ] **Step 3: `src/ds/DayPickerMock.tsx`** (popover do DayOfMonthInput: input + lista, "dia 12" em destaque)

```tsx
// Espelho do DayOfMonthInput aberto (lista rolada na região do alvo).
export const DayPickerMock: React.FC<{ typed: string; days: number[]; selected?: number }> =
  ({ typed, days, selected }) => (
  <div className="w-[140px] rounded-md border border-border bg-bg-surface overflow-hidden"
       style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.45)' }}>
    <div className="p-2 border-b border-border">
      <div className="h-9 rounded-sm bg-bg-elevated border border-border text-fg text-center leading-9 font-sans"
           style={{ fontVariantNumeric: 'tabular-nums' }}>{typed || '1-31'}</div>
    </div>
    <div>
      {days.map(d => (
        <div key={d} className={`px-3 py-1.5 text-body-md font-sans ${
          d === selected ? 'bg-tom/15 text-tom font-semibold' : 'text-fg'}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}>dia {d}</div>
      ))}
    </div>
  </div>
);
```

- [ ] **Step 4: `src/ds/WhatsAppChat.tsx`**

```tsx
// Chat WhatsApp dark mock: header com avatar do TOM + bolhas in/out com slide.
import { Img, staticFile, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export type ChatMsg = { from: 'tom' | 'user'; text: string; atFrame: number };

export const WhatsAppChat: React.FC<{ messages: ChatMsg[] }> = ({ messages }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: '#0B141A' }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: '#1F2C34' }}>
        <Img src={staticFile('brand/Avata-Tom.png')} className="w-9 h-9 rounded-full" />
        <div>
          <div className="text-fg text-body-lg font-sans font-semibold">TOM</div>
          <div className="text-fg-muted text-[11px] font-sans">online</div>
        </div>
      </div>
      <div className="flex-1 px-3 pt-4 flex flex-col gap-2">
        {messages.map((m, i) => {
          if (frame < m.atFrame) return null;
          const s = spring({ frame: frame - m.atFrame, fps, config: { damping: 14 } });
          return (
            <div key={i}
                 className={`max-w-[78%] px-3 py-2 rounded-lg text-body-md font-sans text-fg ${
                   m.from === 'user' ? 'self-end' : 'self-start'}`}
                 style={{
                   background: m.from === 'user' ? '#005C4B' : '#1F2C34',
                   transform: `translateY(${(1 - s) * 18}px) scale(${0.92 + s * 0.08})`, opacity: s,
                 }}>
              {m.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Verificar** → `npx tsc --noEmit` → sem erros.

---

### Task 9: scenes/Intro.tsx + Outro.tsx

**Files:**
- Create: `src/scenes/Intro.tsx`, `src/scenes/Outro.tsx`

- [ ] **Step 1: `src/scenes/Intro.tsx`** (genérica: reusada por qualquer vídeo)

```tsx
import { AbsoluteFill, Img, staticFile, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export const Intro: React.FC<{ title: string; kicker?: string }> = ({ title, kicker = 'Novidade no LA Organizer' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11 } });
  const up = spring({ frame: frame - 8, fps, config: { damping: 13 } });
  return (
    <AbsoluteFill className="bg-bg-app items-center justify-center">
      {/* glow verde de marca */}
      <div className="absolute w-[900px] h-[900px] rounded-full"
           style={{ background: 'radial-gradient(circle, rgba(163,190,80,0.16) 0%, transparent 65%)' }} />
      <Img src={staticFile('brand/Avata-Tom.png')} className="w-64 h-64 rounded-full"
           style={{ transform: `scale(${pop})` }} />
      <div className="mt-12 text-fg-muted text-[34px] font-sans font-semibold uppercase tracking-widest"
           style={{ opacity: up }}>{kicker}</div>
      <div className="mt-3 px-16 text-center text-fg font-display"
           style={{ fontSize: 96, lineHeight: 1.02, opacity: up, transform: `translateY(${(1 - up) * 40}px)` }}>
        {title}
      </div>
      <div className="mt-10 h-2 w-44 rounded-full bg-tom" style={{ transform: `scaleX(${pop})`, opacity: interpolate(frame, [10, 20], [0, 1], { extrapolateRight: 'clamp' }) }} />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: `src/scenes/Outro.tsx`**

```tsx
import { AbsoluteFill, Img, staticFile, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const Outro: React.FC<{ message?: string }> = ({ message = 'Já disponível no seu app' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill className="bg-bg-app items-center justify-center">
      <Img src={staticFile('brand/Avata-Tom.png')} className="w-52 h-52 rounded-full" style={{ transform: `scale(${s})` }} />
      <div className="mt-10 text-fg font-display text-center px-16" style={{ fontSize: 76, opacity: s }}>{message}</div>
      <Img src={staticFile('brand/logo-la-music-dark-completa.svg')} className="mt-16 w-72" style={{ opacity: s * 0.9 }} />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Verificar** → `npx tsc --noEmit` → sem erros.

---

### Task 10: Roteiro + narration.tsx + Root com calculateMetadata

**Files:**
- Create: `src/videos/grupos-de-tarefas/roteiro.ts`
- Create: `src/lib/narration.tsx`
- Modify: `src/Root.tsx` (substituir placeholder)
- Create: `src/videos/grupos-de-tarefas/GruposVideo.tsx` (esqueleto com placeholders)

- [ ] **Step 1: `roteiro.ts`** — textos FINAIS (PT-BR, voz do TOM em 1ª pessoa):

```ts
export type Cena = {
  id: string;
  narracao: string;     // texto falado (ElevenLabs)
  caption: string;      // legenda 1 linha (WhatsApp sem som)
  duracaoMinS: number;  // duração mínima; áudio pode esticar
};

export const VIDEO_ID = 'grupos-de-tarefas';

export const ROTEIRO: Cena[] = [
  { id: 'intro', duracaoMinS: 4, caption: 'Novidade: Grupos de Tarefas 🗂️',
    narracao: 'Chegou novidade no seu LA Organizer: Grupos de Tarefas!' },
  { id: 'problema', duracaoMinS: 6, caption: 'Rotinas que repetem todo mês, cada uma com seu dia',
    narracao: 'Sabe aquela rotina que repete todo mês? Tipo conciliar os cartões — cada loja com seu dia.' },
  { id: 'criar', duracaoMinS: 8, caption: 'Novo → Grupo → dá um nome',
    narracao: 'Criar é fácil: toca em Novo, escolhe Grupo, e dá um nome.' },
  { id: 'subtarefas', duracaoMinS: 11, caption: 'Cada subtarefa com dia, hora e lembrete · Mensal 🔁',
    narracao: 'Aí vai adicionando as subtarefas, cada uma com seu dia, horário e lembrete. Marcou Mensal? O grupo renasce sozinho todo mês.' },
  { id: 'diaadia', duracaoMinS: 9, caption: 'Barra de progresso na tela Hoje · fecha sozinho 🎉',
    narracao: 'No dia a dia, o grupo aparece na tela Hoje com a barra de progresso. Concluiu a última? Ele fecha sozinho — e eu comemoro junto.' },
  { id: 'whatsapp', duracaoMinS: 8, caption: 'Eu lembro e você conclui por mensagem ✅',
    narracao: 'E pelo WhatsApp eu te lembro na hora certa — e você conclui só me mandando uma mensagem.' },
  { id: 'outro', duracaoMinS: 4, caption: 'Já disponível no seu app',
    narracao: 'Já tá disponível no seu app. Bora organizar!' },
];
```

- [ ] **Step 2: `src/lib/narration.tsx`** — áudio + caption + medição:

```tsx
import { Audio, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { interpolate, useCurrentFrame } from 'remotion';
import { sceneDuration } from './timing';
import type { Cena } from '../videos/grupos-de-tarefas/roteiro';

export type SceneMeta = { id: string; durationInFrames: number; audioFile: string | null };

/** Mede os áudios do manifest; sem manifest (ainda não gerado) usa duracaoMinS. */
export async function measureScenes(videoId: string, roteiro: Cena[]): Promise<SceneMeta[]> {
  let manifest: Record<string, string> | null = null;
  try {
    const res = await fetch(staticFile(`audio/${videoId}/manifest.json`));
    if (res.ok) manifest = await res.json();
  } catch { manifest = null; }
  return Promise.all(roteiro.map(async (c) => {
    const file = manifest?.[c.id] ? `audio/${videoId}/${manifest[c.id]}` : null;
    const audioS = file ? await getAudioDurationInSeconds(staticFile(file)) : null;
    return { id: c.id, durationInFrames: sceneDuration(audioS, c.duracaoMinS), audioFile: file };
  }));
}

export const SceneAudio: React.FC<{ meta: SceneMeta }> = ({ meta }) =>
  meta.audioFile ? <Audio src={staticFile(meta.audioFile)} /> : null;

export const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div className="absolute inset-x-0 bottom-[72px] flex justify-center z-50" style={{ opacity }}>
      <div className="max-w-[80%] px-7 py-3 rounded-full bg-black/70 text-fg text-[30px] font-sans font-medium text-center">
        {text}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: `GruposVideo.tsx` esqueleto** (placeholders coloridos; cenas reais na Task 11):

```tsx
import { AbsoluteFill, Series } from 'remotion';
import { ROTEIRO } from './roteiro';
import { Caption, SceneAudio, type SceneMeta } from '../../lib/narration';

export const GruposVideo: React.FC<{ scenes: SceneMeta[] }> = ({ scenes }) => (
  <Series>
    {ROTEIRO.map((cena, i) => {
      const meta = scenes[i] ?? { id: cena.id, durationInFrames: cena.duracaoMinS * 30, audioFile: null };
      return (
        <Series.Sequence key={cena.id} durationInFrames={meta.durationInFrames}>
          <AbsoluteFill className="bg-bg-app items-center justify-center">
            <div className="text-fg-muted text-h2-brand font-sans">{cena.id}</div>
          </AbsoluteFill>
          <SceneAudio meta={meta} />
          <Caption text={cena.caption} />
        </Series.Sequence>
      );
    })}
  </Series>
);
```

- [ ] **Step 4: `Root.tsx` final**

```tsx
import './style.css';
import './lib/fonts';
import { Composition } from 'remotion';
import { GruposVideo } from './videos/grupos-de-tarefas/GruposVideo';
import { ROTEIRO, VIDEO_ID } from './videos/grupos-de-tarefas/roteiro';
import { measureScenes, type SceneMeta } from './lib/narration';
import { sec } from './lib/timing';

export const Root: React.FC = () => (
  <Composition
    id={VIDEO_ID}
    component={GruposVideo}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ scenes: [] as SceneMeta[] }}
    calculateMetadata={async ({ props }) => {
      const scenes = await measureScenes(VIDEO_ID, ROTEIRO);
      const durationInFrames = scenes.reduce((a, s) => a + s.durationInFrames, 0);
      return { durationInFrames: Math.max(durationInFrames, sec(10)), props: { ...props, scenes } };
    }}
  />
);
```

- [ ] **Step 5: Verificar no Studio**

Run: `npx tsc --noEmit` (sem erros) e `npx remotion studio`
Expected: composição `grupos-de-tarefas` com **7 sequências** nomeadas pelos ids, duração total = soma dos `duracaoMinS` (50s = 1500 frames; sem áudio ainda). Captions aparecem.

---

### Task 11: As 5 cenas visuais + montagem final

**Files:**
- Create: `src/videos/grupos-de-tarefas/cenas/Problema.tsx`, `Criar.tsx`, `Subtarefas.tsx`, `DiaADia.tsx`, `WhatsApp.tsx`
- Modify: `src/videos/grupos-de-tarefas/GruposVideo.tsx`

Cada cena é um componente sem props que usa `useCurrentFrame()` local (Series re-zera o frame por sequência). Frames de coreografia abaixo assumem a duração mínima; o respiro extra do áudio só prolonga o estado final — nunca corta ação.

- [ ] **Step 1: `cenas/Problema.tsx`** — card flutuante com subtarefas materializando:

```tsx
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Checkbox } from '../../../ds/Checkbox';
import { Pill } from '../../../ds/Pill';

const ITENS = [
  { t: 'Cartão Barra', d: 'dia 12' },
  { t: 'Cartão Recreio', d: 'dia 17' },
  { t: 'Cartão Mercado Pago', d: 'dia 25' },
];

export const Problema: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = spring({ frame, fps, config: { damping: 13 } });
  return (
    <AbsoluteFill className="bg-bg-app items-center justify-center">
      <div className="w-[760px] rounded-lg bg-bg-surface border border-border p-10 shadow-soft"
           style={{ transform: `translateY(${(1 - card) * 60}px) scale(${0.94 + card * 0.06})`, opacity: card }}>
        <div className="flex items-center gap-4">
          <span style={{ fontSize: 44 }}>🗂️</span>
          <span className="text-fg font-sans font-bold" style={{ fontSize: 44 }}>Conciliação Cartões</span>
        </div>
        <div className="mt-8 flex flex-col gap-5">
          {ITENS.map((it, i) => {
            const s = spring({ frame: frame - 22 - i * 14, fps, config: { damping: 13 } });
            return (
              <div key={it.t} className="flex items-center gap-5"
                   style={{ opacity: s, transform: `translateX(${(1 - s) * 40}px)` }}>
                <Checkbox checked={false} size={34} />
                <span className="text-fg font-sans flex-1" style={{ fontSize: 34 }}>{it.t}</span>
                <div style={{ transform: 'scale(1.5)', transformOrigin: 'right center' }}>
                  <Pill icon={<span>📅</span>} label={it.d} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: `cenas/Criar.tsx`** — QuickCreate no celular, cursor clica em Grupo, digita o título:

```tsx
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { PhoneFrame } from '../../../ds/PhoneFrame';
import { KindButtonMock } from '../../../ds/KindButtonMock';
import { SheetMock } from '../../../ds/SheetMock';
import { Cursor } from '../../../lib/Cursor';
import { useTypewriter } from '../../../lib/useTypewriter';

export const Criar: React.FC = () => {
  const frame = useCurrentFrame();
  const grupoSelected = frame >= 58;
  const { shown, caretOn, done } = useTypewriter('Conciliação Cartões', 85, 13);
  return (
    <AbsoluteFill className="bg-bg-app">
      <PhoneFrame>
        <SheetMock title="Novo" heightPct={86}>
          <div className="grid grid-cols-4 gap-2">
            <KindButtonMock icon="📝" label="Tarefa" hint="algo a fazer" />
            <KindButtonMock icon="📅" label="Compromisso" hint="com horário" />
            <KindButtonMock icon="🤝" label="Delegar" hint="pra alguém" />
            <KindButtonMock icon="🗂️" label="Grupo" hint="subtarefas" selected={grupoSelected} />
          </div>
          <div className="mt-4">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Título</div>
            <div className="h-11 rounded-md bg-bg-elevated border border-border px-3 flex items-center text-body-lg text-fg font-sans">
              {shown}{!done && caretOn && <span className="text-tom">|</span>}
            </div>
          </div>
        </SheetMock>
        {/* coords no espaço 390×844 do PhoneFrame: alvo = card Grupo (x≈345,y≈225), depois campo título */}
        <Cursor keyframes={[
          { frame: 10, x: 200, y: 600 },
          { frame: 50, x: 345, y: 225 },
          { frame: 58, x: 345, y: 225, click: true },
          { frame: 80, x: 195, y: 330 },
          { frame: 85, x: 195, y: 330, click: true },
        ]} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: `cenas/Subtarefas.tsx`** — editor com DayPickerMock + lista crescendo + Mensal:

```tsx
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig } from 'remotion';
import { PhoneFrame } from '../../../ds/PhoneFrame';
import { SheetMock } from '../../../ds/SheetMock';
import { Pill } from '../../../ds/Pill';
import { Checkbox } from '../../../ds/Checkbox';
import { DayPickerMock } from '../../../ds/DayPickerMock';
import { Cursor } from '../../../lib/Cursor';
import { useTypewriter } from '../../../lib/useTypewriter';

export const Subtarefas: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tw = useTypewriter('Cartão Barra', 8, 13);
  const pickerOpen = frame >= 55 && frame < 110;
  const day12 = frame >= 100;
  const reminderOn = frame >= 130;
  const row1 = spring({ frame: frame - 160, fps, config: { damping: 13 } });  // "Adicionar" → vira linha
  const row2 = spring({ frame: frame - 200, fps, config: { damping: 13 } });  // Recreio dia 17 (atalho)
  const mensalOn = frame >= 250;
  return (
    <AbsoluteFill className="bg-bg-app">
      <PhoneFrame>
        <SheetMock title="Novo grupo" heightPct={86}>
          <div className="text-label uppercase tracking-wide text-fg-muted mb-1">Subtarefas <span className="normal-case font-normal">cada uma com seu prazo</span></div>
          {/* linhas adicionadas */}
          {row1 > 0.02 && (
            <div className="flex items-center gap-2 py-2" style={{ opacity: row1 }}>
              <Checkbox checked={false} /><span className="text-body-md text-fg font-sans flex-1">Cartão Barra</span>
              <Pill icon={<span>📅</span>} label="dia 12" /><Pill icon={<span>🔔</span>} label="1" />
            </div>
          )}
          {row2 > 0.02 && (
            <div className="flex items-center gap-2 py-2" style={{ opacity: row2 }}>
              <Checkbox checked={false} /><span className="text-body-md text-fg font-sans flex-1">Cartão Recreio</span>
              <Pill icon={<span>📅</span>} label="dia 17" /><Pill icon={<span>🔔</span>} label="1" />
            </div>
          )}
          {/* box de adicionar */}
          <div className="mt-2 rounded-md border border-dashed border-border bg-bg-elevated/40 p-3">
            <div className="flex items-center gap-2">
              <Checkbox checked={false} />
              <span className="text-body-md text-fg font-sans">
                {row1 > 0.02 ? '' : tw.shown}{row1 <= 0.02 && !tw.done && tw.caretOn && <span className="text-tom">|</span>}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Pill icon={<span>📅</span>} label={day12 ? 'dia 12' : 'dia'} muted={!day12} active={frame >= 100 && frame <= 112} />
              <Pill icon={<span>🕐</span>} label="09:00" muted />
              <div className="ml-auto"><Pill label="Adicionar" active={frame >= 152 && frame <= 164} /></div>
            </div>
            <div className="mt-2 flex gap-1.5 flex-wrap">
              {['Na hora', '15min antes', '1 dia antes'].map((r, i) => (
                <Pill key={r} label={r} active={i === 2 && reminderOn} />
              ))}
            </div>
          </div>
          {/* recorrência */}
          <div className="mt-4 flex gap-2">
            <Pill label="Mensal" active={mensalOn} />
            <Pill label="Não repete" muted={mensalOn} active={!mensalOn} />
          </div>
        </SheetMock>
        {pickerOpen && <div className="absolute left-[36px] top-[330px] z-40">
          <DayPickerMock typed={frame >= 80 ? '12' : ''} days={[10, 11, 12, 13, 14]} selected={day12 ? 12 : undefined} />
        </div>}
        <Cursor keyframes={[
          { frame: 12, x: 130, y: 285 },
          { frame: 50, x: 65, y: 305 },
          { frame: 55, x: 65, y: 305, click: true },     // abre picker de dia
          { frame: 95, x: 78, y: 415 },
          { frame: 100, x: 78, y: 415, click: true },    // dia 12
          { frame: 126, x: 300, y: 390 },
          { frame: 130, x: 300, y: 390, click: true },   // 1 dia antes
          { frame: 148, x: 330, y: 350 },
          { frame: 152, x: 330, y: 350, click: true },   // Adicionar
          { frame: 196, x: 330, y: 350, click: true },   // (atalho 2ª subtarefa)
          { frame: 240, x: 60, y: 560 },
          { frame: 250, x: 60, y: 560, click: true },    // Mensal
        ]} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 4: `cenas/DiaADia.tsx`** — card no Hoje, sheet, última concluída, 🎉:

```tsx
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig, interpolate } from 'remotion';
import { PhoneFrame } from '../../../ds/PhoneFrame';
import { SheetMock } from '../../../ds/SheetMock';
import { Checkbox } from '../../../ds/Checkbox';
import { ProgressBar } from '../../../ds/ProgressBar';
import { Cursor } from '../../../lib/Cursor';

const SUBS = [
  { t: 'Cartão Barra', doneAt: 0 },
  { t: 'Cartão Recreio', doneAt: 0 },
  { t: 'Cartão Mercado Pago', doneAt: 95 }, // cursor marca aos 95
];

export const DiaADia: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sheetUp = spring({ frame: frame - 45, fps, config: { damping: 14 } });
  const doneCount = SUBS.filter(s => s.doneAt === 0 || frame >= s.doneAt).length;
  const pct = interpolate(doneCount, [0, SUBS.length], [0, 100]);
  const allDone = frame >= 95;
  const fest = spring({ frame: frame - 100, fps, config: { damping: 9 } });
  return (
    <AbsoluteFill className="bg-bg-app">
      <PhoneFrame>
        <div className="px-4 pt-3">
          <div className="text-screen-title text-fg font-sans">Hoje</div>
          {/* card do grupo */}
          <div className={`mt-3 rounded-md border p-3 ${allDone ? 'border-tom bg-tom/10' : 'border-border bg-bg-surface'}`}>
            <div className="flex items-center gap-2">
              <span>🗂️</span>
              <span className="text-card-title text-fg font-sans flex-1">Conciliação Cartões</span>
              <span className={`text-body-sm font-sans ${allDone ? 'text-tom font-semibold' : 'text-fg-muted'}`}>{doneCount}/3</span>
            </div>
            <div className="mt-2"><ProgressBar pct={pct} /></div>
          </div>
        </div>
        {/* sheet do grupo */}
        <div style={{ opacity: sheetUp, transform: `translateY(${(1 - sheetUp) * 120}px)` }}>
          <SheetMock title="Conciliação Cartões" heightPct={62}>
            <div className="flex flex-col">
              {SUBS.map((s2) => {
                const done = s2.doneAt === 0 || frame >= s2.doneAt;
                return (
                  <div key={s2.t} className="flex items-center gap-3 py-3 border-b border-border">
                    <Checkbox checked={done} />
                    <span className={`text-body-lg font-sans ${done ? 'text-fg-muted line-through' : 'text-fg'}`}>{s2.t}</span>
                  </div>
                );
              })}
            </div>
          </SheetMock>
        </div>
        {allDone && (
          <div className="absolute inset-x-0 top-[150px] flex justify-center z-40"
               style={{ transform: `scale(${fest})`, opacity: Math.min(1, fest * 1.2) }}>
            <div className="px-5 py-3 rounded-full bg-tom text-black font-sans font-bold text-body-lg shadow-soft">
              🎉 Grupo completo!
            </div>
          </div>
        )}
        <Cursor keyframes={[
          { frame: 20, x: 200, y: 700 },
          { frame: 55, x: 60, y: 640 },
          { frame: 90, x: 60, y: 640 },
          { frame: 95, x: 60, y: 640, click: true }, // marca a última (3ª linha do sheet)
          { frame: 120, x: 200, y: 720 },
        ]} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 5: `cenas/WhatsApp.tsx`**

```tsx
import { AbsoluteFill } from 'remotion';
import { PhoneFrame } from '../../../ds/PhoneFrame';
import { WhatsAppChat } from '../../../ds/WhatsAppChat';

export const WhatsApp: React.FC = () => (
  <AbsoluteFill className="bg-bg-app">
    <PhoneFrame>
      <WhatsAppChat messages={[
        { from: 'tom', text: '🔔 Bom dia, Rose! Hoje tem: Cartão Barra (grupo Conciliação Cartões).', atFrame: 12 },
        { from: 'user', text: 'conclui o cartão Barra', atFrame: 85 },
        { from: 'tom', text: '✅ Feito! Cartão Barra concluído. Faltam 2 nesse grupo. 💪', atFrame: 150 },
      ]} />
    </PhoneFrame>
  </AbsoluteFill>
);
```

- [ ] **Step 6: Montagem — `GruposVideo.tsx` final**

```tsx
import { AbsoluteFill, Series, useCurrentFrame, interpolate } from 'remotion';
import { ROTEIRO } from './roteiro';
import { Caption, SceneAudio, type SceneMeta } from '../../lib/narration';
import { Intro } from '../../scenes/Intro';
import { Outro } from '../../scenes/Outro';
import { Problema } from './cenas/Problema';
import { Criar } from './cenas/Criar';
import { Subtarefas } from './cenas/Subtarefas';
import { DiaADia } from './cenas/DiaADia';
import { WhatsApp } from './cenas/WhatsApp';

const CENAS: Record<string, React.FC> = {
  intro: () => <Intro title="Grupos de Tarefas" />,
  problema: Problema,
  criar: Criar,
  subtarefas: Subtarefas,
  diaadia: DiaADia,
  whatsapp: WhatsApp,
  outro: () => <Outro />,
};

const FadeIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' }) }}>{children}</AbsoluteFill>;
};

export const GruposVideo: React.FC<{ scenes: SceneMeta[] }> = ({ scenes }) => (
  <Series>
    {ROTEIRO.map((cena, i) => {
      const meta = scenes[i] ?? { id: cena.id, durationInFrames: cena.duracaoMinS * 30, audioFile: null };
      const Cena = CENAS[cena.id];
      return (
        <Series.Sequence key={cena.id} durationInFrames={meta.durationInFrames}>
          <FadeIn><Cena /></FadeIn>
          <SceneAudio meta={meta} />
          <Caption text={cena.caption} />
        </Series.Sequence>
      );
    })}
  </Series>
);
```

- [ ] **Step 7: Verificar no Studio**

Run: `npx tsc --noEmit` e `npx remotion studio`
Expected: scrub pelas 7 cenas — Intro com avatar, Problema com card, Criar com cursor clicando em Grupo + digitação, Subtarefas com picker "dia 12", DiaADia com barra enchendo + 🎉, WhatsApp com 3 bolhas, Outro com logos. Ajustar coordenadas de Cursor se algum alvo deslocar (esperado ±15px de tuning manual; validar visualmente frame a frame nos cliques).

---

### Task 12: Narração real + render + validação

- [ ] **Step 1: Gerar narração**

Run: `cd D:\la-organizer\video-studio; npm run narration -- grupos-de-tarefas`
Expected: `cache: 0 mantidos · 7 a gerar · 0 obsoletos`, 7 × `gerado: <id>.<hash>.mp3 (~XX KB)`, `manifest.json escrito com 7 cenas`.

- [ ] **Step 2: Rodar de novo (prova do cache)**

Run: `npm run narration -- grupos-de-tarefas`
Expected: `cache: 7 mantidos · 0 a gerar · 0 obsoletos` (nenhuma chamada à API).

- [ ] **Step 3: Conferir durações no Studio** — total deve ir de 50s pra ~52–60s (cenas esticadas pelo áudio). Ouvir 2 cenas no preview pra validar voz/sincronização.

- [ ] **Step 4: Render final**

Run: `npx remotion render grupos-de-tarefas out/grupos-de-tarefas.mp4`
Expected: MP4 H.264 1080×1920 em `out/`, sem erros. Conferir: arquivo > 2 MB e duração 50–62s (`(Get-Item out\grupos-de-tarefas.mp4).Length`; duração via Studio ou propriedades).

- [ ] **Step 5: Testes finais** — `npm run test` (timing + narration-lib PASS) e `npx tsc --noEmit` limpo.

- [ ] **Step 6: Entrega** — screenshots de 3 frames-chave (Intro, Subtarefas com picker, DiaADia 🎉) pro Alf + caminho do MP4 pra ele mandar no WhatsApp da Rose.

---

## Self-review (feito na escrita)

- **Cobertura da spec:** estrutura/pastas (T1), .env+assets (T2), tokens (T3), timing áudio-dita-tempo (T4, T10), cache por hash + manifest (T5), cursor/câmera/digitação (T6), réplicas DS (T7-T8), Intro/Outro (T9), roteiro 7 cenas + calculateMetadata (T10), cenas visuais (T11), narração real + render MP4 + critérios de aceite (T12). Legendas: `Caption` (T10). Fora de escopo respeitado (sem 16:9, sem karaokê, sem envio automático).
- **Placeholders:** nenhum TBD/TODO; todo step de código tem o código.
- **Consistência de tipos:** `Cena`/`ROTEIRO`/`VIDEO_ID` (T10) usados em T5 (via JSON) e T11; `SceneMeta` definida em narration.tsx e usada em Root/GruposVideo; `sceneDuration(audioSeconds, minSeconds)` igual em T4 e narration.tsx; `planFiles` retorna `{keep, generate, stale}` igual no teste e no gen-narration.
- **Riscos sinalizados no plano:** coordenadas de cursor pedem tuning visual (T11 Step 7); import de roteiro.ts em script node via tsx (T5 Step 3) — se o eval-import falhar no Windows, fallback documentado: trocar por `npx tsx scripts/gen-narration-entry.ts` que importa o roteiro diretamente.
```
