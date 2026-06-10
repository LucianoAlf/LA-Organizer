# TOM Video Studio — Spec de Design

**Data:** 2026-06-10 · **Status:** aprovada pelo Alf (brainstorm 10/06)
**Objetivo:** pipeline reutilizável de vídeos de demo de produto (estilo Anthropic/Codex) pra anunciar features do LA Organizer à equipe via WhatsApp. Piloto: feature **Grupos de Tarefas** (Rose).

## Decisões tomadas (com o Alf)

| Decisão | Escolha |
|---|---|
| Formato | **Vertical 9:16**, 1080×1920, 30fps, MP4 H.264 (WhatsApp) |
| Conteúdo de tela | **100% sintético no Remotion** (abordagem A: réplicas das telas com componentes do próprio estúdio, mesmos tokens do DS) |
| Narração | **ElevenLabs**, voz real do TOM (`xtPlXcRNvdlUVw2QsITM`), modelo `eleven_multilingual_v2`, 100% PT-BR |
| Localização | **`D:\la-organizer\video-studio\`** — FORA do `_remote` (não entra em git/Vercel/VPS) |
| Licença Remotion | Alf ciente dos termos; uso interno/pequena escala, sem comercialização em larga escala — sem bloqueio |

## Arquitetura

```
D:\la-organizer\video-studio\
  package.json            # remotion, @remotion/cli, @remotion/tailwind,
                          # @remotion/media-utils, react 18.3, tailwindcss 3.4, tsx
  remotion.config.ts      # entrada, overwrite, codec h264
  tailwind.config.js      # tokens copiados do PWA (bg-bg-*, fg, tom, border...)
  .env                    # ELEVENLABS_API_KEY (copiada da VPS via ssh; fora de git)
  public/
    brand/                # Avata-Tom.png, logos LA Music (copiados de web/public)
    audio/<video-id>/     # MP3 por cena (gerados, cacheados)
  src/
    Root.tsx              # registra composições; calculateMetadata mede áudios
    styles/tokens.css     # CSS vars do DS (copiadas de web/src/index.css)
    ds/                   # réplicas visuais do Design System
      PhoneFrame.tsx      #   moldura de celular flutuante (tela 390×844 escalada)
      Checkbox.tsx, Pill.tsx, SheetMock.tsx, KindButtonMock.tsx, ProgressBar.tsx
      WhatsAppChat.tsx    #   bolhas de chat mock (header com avatar TOM)
    lib/
      Cursor.tsx          # cursor/dedinho animado: keyframes (x,y,frame) + spring
      useTypewriter.ts    # digitação letra-a-letra por frame
      narration.ts        # <Narration sceneId> = <Audio> da cena + caption
      timing.ts           # seg↔frames, padding de cena, sequenciador
    scenes/
      Intro.tsx           # marca: avatar TOM + título da feature (4s)
      Outro.tsx           # logo + "Já disponível no seu app" (4s)
    videos/
      grupos-de-tarefas/
        roteiro.ts        # array de cenas: {id, narracao, caption, duracaoMin}
        GruposVideo.tsx   # composição: monta cenas na ordem, dimensiona pelo áudio
  scripts/
    setup-env.mjs         # puxa ELEVENLABS_* da VPS: ssh tom "grep ELEVENLABS /opt/LA-Organizer/.env"
    gen-narration.mjs     # (tsx) lê roteiro.ts → POST ElevenLabs por cena → public/audio/
  out/                    # MP4 renderizados (out/grupos-de-tarefas.mp4)
```

### Princípio central — áudio dita o tempo
1. `gen-narration.mjs <video-id>` gera 1 MP3 por cena (pula os que já existem e cujo texto não mudou — hash do texto no nome do arquivo: `<sceneId>.<hash8>.mp3`).
2. No `Root.tsx`, `calculateMetadata` usa `getAudioDurationInSeconds` (@remotion/media-utils) pra medir cada MP3.
3. Cada cena dura `max(duracaoMin, duraçãoÁudio + 0.8s de respiro)`. A composição soma as cenas → narração e ação nunca dessincronizam.

### Voice settings (derivados do tts.js do TOM, ajustados pra narração)
`stability 0.5, similarity_boost 0.75, style 0.4, use_speaker_boost true, speed 1.05`
(WhatsApp usa 1.15 pra mensagens curtas; narração de vídeo pede ritmo um pouco mais calmo.)

### Réplica do DS — regras
- Mesmas versões do PWA: React 18.3, Tailwind 3.4 (plugin oficial @remotion/tailwind).
- `tailwind.config.js` e `tokens.css` copiados do `web/` (fonte de verdade visual: `bg-bg-app #0E0F0C`-família, `tom #A3BE50`, `fg`, `border` etc. — copiar valores reais na implementação).
- Réplicas são SIMPLIFICADAS e otimizadas pra vídeo: fontes ~15% maiores, espaçamento maior, sem estados que não aparecem em cena. Fidelidade de "irmão gêmeo", não pixel-perfect.
- Tudo vetor (HTML/CSS/SVG) — zoom sem serrilhar.

### Cursor e interação
- `Cursor.tsx`: bolinha/dedinho com sombra suave; trajetória por keyframes `{frame, x, y, click?}` interpolada com `spring()` do Remotion; no `click`, ripple + scale do alvo.
- Digitação: `useTypewriter(texto, startFrame, cps≈14)` revela o texto com caret piscando.
- Popovers/sheets animam com spring de entrada (igual ao app).

### Legendas (WhatsApp sem som)
Caption de 1 linha por cena (campo `caption` do roteiro), pill discreta no rodapé, fade in/out. Não é karaokê palavra-a-palavra (YAGNI v1).

## Roteiro do piloto — `grupos-de-tarefas` (~55s)

| # | Cena | Ação na tela | Narração (PT-BR, voz do TOM) |
|---|---|---|---|
| 1 | Intro (4s) | Avatar TOM pulsa, título "Grupos de Tarefas" sobe | "Chegou novidade no seu LA Organizer: Grupos de Tarefas!" |
| 2 | Problema (6s) | Card "Conciliação Cartões" flutua, 3 subtarefas materializam com dias 12/17/25 | "Sabe aquela rotina que repete todo mês — tipo conciliar os cartões, cada loja com seu dia?" |
| 3 | Criar grupo (10s) | Cursor abre "Novo" → clica "Grupo" → digita "Conciliação Cartões" | "Agora você cria um grupo: no botão Novo, escolhe Grupo e dá um nome." |
| 4 | Subtarefas (12s) | Digita "Cartão Barra" → abre o seletor de dia (popover lista) → escolhe 12 → lembrete "1 dia antes" → Adicionar; repete rápido "Cartão Recreio" dia 17; toggle "Mensal" aceso | "Aí vai adicionando as subtarefas, cada uma com seu dia, horário e lembrete. Marcou Mensal? O grupo inteiro renasce sozinho todo mês." |
| 5 | Dia a dia (10s) | Tela Hoje com card do grupo (2/3 + barra); sheet abre; cursor marca a última; barra enche; 🎉 confete leve e grupo conclui | "No dia a dia, o grupo aparece na sua tela Hoje com a barra de progresso. Concluiu a última? Ele fecha sozinho." |
| 6 | TOM no WhatsApp (8s) | Chat mock: TOM "🔔 Hoje: Cartão Barra"; usuário digita "conclui o cartão Barra"; TOM "✅ Feito! Faltam 2 nesse grupo." | "E o TOM acompanha tudo pelo WhatsApp: te lembra na hora certa e você conclui por mensagem." |
| 7 | Outro (4s) | Logo LA + avatar TOM, "Já disponível no seu app" | "Já tá disponível no seu app. Bora organizar!" |

Dados fictícios do roteiro usam o caso real da Rose (conciliação, dias 12/17/25) — é o exemplo que ela reconhece.

## Workflow de produção

```
npm run setup            # 1x: instala deps + puxa .env da VPS + copia assets de marca
npm run narration -- grupos-de-tarefas   # gera/atualiza MP3s (cache por hash)
npm run studio           # Remotion Studio (preview ao vivo pra iterar)
npm run render -- grupos-de-tarefas      # MP4 final em out/
```

Vídeo novo = nova pasta `src/videos/<id>/` (roteiro + composição) reusando `ds/`, `lib/` e `scenes/`.

## Validação
- Iteração visual: Remotion Studio + screenshots de frames-chave pro Alf aprovar antes do render final.
- Lib `timing.ts` e cache de narração: testes unitários leves (vitest) — conversão seg↔frames e hash/skip de regeneração.
- Critério de aceite do piloto: MP4 9:16 ≤ 60s, narração na voz do TOM sincronizada, 7 cenas do roteiro, legível em tela de celular, enviado no WhatsApp do Alf pra teste real.

## Fora de escopo (v1)
- Versão 16:9 / desktop do template (formato escolhido: só 9:16).
- Karaokê de legenda palavra-a-palavra.
- Geração automática de roteiro a partir de spec de feature (por enquanto roteiro é escrito à mão por vídeo).
- Upload/envio automático pro WhatsApp (envio manual pelo Alf; integração UAZAPI pode vir depois).

## Riscos e notas
- **ElevenLabs**: ~700 caracteres por vídeo; cota compartilhada com o TTS do TOM no WhatsApp — monitorar se escalar a produção.
- **Remotion company license**: registrado; Alf decidiu seguir sem (uso interno, sem comercialização em larga escala).
- **Chave da API local**: `.env` do estúdio fica fora de qualquer git; cópia manual via `setup-env.mjs` (ssh tom).
- **Fidelidade visual**: réplicas podem divergir do app após redesigns — aceito; roteiro novo confere as telas vigentes antes de renderizar.
