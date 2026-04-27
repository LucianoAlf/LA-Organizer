# Audio Runtime Setup

Como habilitar transcrição de áudio em runtime real.

## Estado atual

- ✅ Detecção de áudio no webhook (já existia: `whatsapp.isAudioMessage`)
- ✅ Pipeline de transcrição (`src/services/audio.js`) — Whisper API ready
- ✅ Hook no webhook: detecta áudio → tenta transcrever → fallback gracioso
- ✅ Skill `tratamento-audio` é carregada quando o texto vem de áudio (prefixo `[áudio transcrito]`)
- ⏳ Provider de transcrição: precisa de chave de API (não provisionada na sprint Fase 1C)

Sem `OPENAI_API_KEY` configurada, o TOM responde graciosamente:

> recebi seu áudio. Por enquanto eu não tô processando áudio aqui — me manda o mesmo recado em texto, por favor?

E nada de side effect é executado.

## Como habilitar Whisper

1. **Provisionar chave OpenAI:**
   - Acessar https://platform.openai.com/api-keys
   - Criar uma chave dedicada (escopo: `audio.transcriptions`)
   - Whisper-1 custa ~$0.006/min — ~$1.80 para 5h de áudio/mês

2. **Adicionar à `.env` do VPS:**
   ```bash
   ssh tom 'echo "OPENAI_API_KEY=sk-..." >> /opt/LA-Organizer/.env && chmod 600 /opt/LA-Organizer/.env'
   ssh tom 'pm2 reload tom'
   ```

3. **Verificar:**
   ```bash
   ssh tom 'cd /opt/LA-Organizer && node -e "
     console.log(require(\"./src/services/audio\").isProviderConfigured() ? \"✅ provider OK\" : \"❌ não configurado\")
   "'
   ```

## Pipeline em runtime

Quando habilitado, o fluxo real é:

1. Webhook recebe payload UAZAPI com `messageType: \"audio\"|\"ptt\"|\"myaudio\"`
2. `audio.transcribeAudio(body)`:
   - Localiza URL do áudio no payload (testa `body.message.audioMessage.url`, `body.audioUrl`, `body.media.url`, etc — 9 paths comuns)
   - Baixa o arquivo via HTTPS (timeout 20s)
   - Envia pra OpenAI `/v1/audio/transcriptions` (model=whisper-1, timeout 60s)
   - Retorna `{ ok: true, text }` ou `{ ok: false, reason: ... }`
3. Webhook prefixa `[áudio transcrito]` no texto e enfileira normalmente
4. `pickSkill` (priority 1.4) detecta o prefixo → carrega skill `tratamento-audio`
5. Claude responde com confirmação (nunca emite marker direto de áudio)
6. User confirma → próxima mensagem cai no fluxo regular (`checklist-tarefas` etc)

## Razões de falha (`reason`)

| `reason` | Significado | Resposta ao usuário |
|---|---|---|
| `no_provider` | Sem `OPENAI_API_KEY` no env | "Por enquanto eu não tô processando áudio aqui" |
| `no_audio_url` | Payload UAZAPI não trouxe URL recognizable | "não consegui baixar o arquivo" |
| `empty_audio` | Download retornou buffer vazio | "o áudio veio vazio" |
| `transcription_empty` | Whisper devolveu string vazia | "não consegui entender" |
| `transcription_error` | HTTP/timeout/parse error no Whisper | "tive um erro" |

Se `reason='no_audio_url'` aparecer com payload real, o `console.warn` no `transcribeAudio` imprime os primeiros 400 chars do body — usar pra ajustar a lista de paths em `findAudioUrl`.

## O que NÃO acontece (por design)

- Áudio bruto **não** é salvo como memória de longo prazo
- Transcrição **não** é mostrada ao colaborador (só interpretação)
- Action **nunca** executa sem o "sim" explícito do colaborador
- Sem provider configurado, o sistema **não engana** dizendo que entendeu — pede texto

## Testes mandatórios da sprint (Fase 1C / Bloco 3)

| # | Cenário | Estado |
|---|---|---|
| T1 | Áudio simples ação clara → confirmação | ⏳ aguarda OPENAI_API_KEY |
| T2 | Áudio múltiplas ações → confirmação multi-item | ⏳ aguarda OPENAI_API_KEY |
| T3 | Áudio ambíguo → pergunta curta | ⏳ aguarda OPENAI_API_KEY |
| T4 | Áudio ruim/incompleto → pede repetição | ⏳ aguarda OPENAI_API_KEY |
| T5 | Áudio só contexto → sem side effect | ⏳ aguarda OPENAI_API_KEY |
| T6 | Confirmação positiva → ação executa | ⏳ aguarda OPENAI_API_KEY |
| T7 | Correção do colaborador → ajusta antes de executar | ⏳ aguarda OPENAI_API_KEY |

T1-T7 dependem de transcrição real funcionando. O **gate de segurança** (sem provider → mensagem graciosa, sem side effect) está validado por inspeção de código + skill já alinhada com a confirmação obrigatória.

Validação ao habilitar:
- Mande um áudio dizendo "fiz a entrevista do professor"
- TOM transcreve via Whisper, prefixo `[áudio transcrito]` carrega skill
- TOM responde: "Entendi: *Entrevista do professor* — feito ✅. Certo?"
- Você responde "sim"
- TOM emite `<<TASK_UPDATE>>{action:complete,...}<<END>>`
- Verificar `marker_logs` para `TASK_UPDATE/executed`
