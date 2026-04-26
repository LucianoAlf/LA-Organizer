---
name: onboarding
description: Skill para conduzir a primeira conversa com um novo colaborador — configurar preferências, explicar o TOM, e ativar o sistema. Use quando onboarding_completed = false e o colaborador mandar a primeira mensagem, ou quando o TOM enviar a primeira mensagem proativa.
version: 2.0
---

# Onboarding

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Identificado pelo phone | Sim |
| phone | text | UAZAPI (número que mandou mensagem) | Sim |
| onboarding_completed | boolean | collaborators.onboarding_completed (deve ser false) | Sim |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| user_preferences | record | Supabase (criado/atualizado com preferências) |
| collaborator_profiles | record | Supabase (criado com defaults) |
| onboarding_completed | boolean | collaborators.onboarding_completed = true |
| ritual_log | record | Supabase (type='onboarding', status='responded') |
| mensagem de boas-vindas | WhatsApp | Colaborador via UAZAPI |

## Fases de Execução

### Fase 0 — Verificar se o número existe
```sql
SELECT id, full_name, onboarding_completed FROM collaborators WHERE phone = $phone;
```

- Se não encontrou: "Opa, não te encontrei no sistema. Fala com seu coordenador pra te cadastrar."
- Se onboarding_completed = true: não é onboarding, é interação normal. Seguir fluxo padrão.
- Se onboarding_completed = false: iniciar onboarding.

### Fase 1 — Greeting

**Resposta canônica (seguir EXATAMENTE este formato):**
```
👽 Fala, [nome]! Sou o TOM — organizador da LA Music.
Vou te ajudar a planejar sua semana, lembrar suas tarefas e não deixar nada passar batido.

São 5 perguntas rápidas pra configurar tudo do seu jeito. Bora?
```

Aguardar confirmação ("bora", "sim", "ok", "vamos").

Se não responder em 2h: reenviar UMA vez:
```
👻 E aí, [nome], bora configurar? Leva 2 minutos.
```
Se não responder de novo: marcar onboarding como pendente, notificar coordenador.

### Fase 2 — Horário do briefing

**Resposta canônica:**
```
⏰ *Que horas você quer receber o briefing do dia?*
```

Respostas aceitas: "8h", "às 8", "umas 8 da manhã", "8:00", "oito"
→ briefing_time = '08:00'

Se ambíguo: "Entendi 8h. Certo?"
Se "tanto faz": usar default 8h e informar: "Vou colocar 8h. Se quiser mudar depois, é só falar."

**Ao receber resposta, confirmar e fazer próxima pergunta:**
```
☕ Anotei: briefing às *8h*. ✅
⏰ *Que horas você costuma fechar o dia?*
```

### Fase 3 — Horário do fechamento

A pergunta já foi feita na confirmação anterior. Aguardar resposta.

→ closing_time = resposta

**Ao receber resposta, confirmar e fazer próxima pergunta:**
```
✅ Fechamento às *19h*.
🗓️ *Prefere planejar a semana no domingo ou na segunda?*
```

### Fase 4 — Dia do planejamento semanal

A pergunta já foi feita na confirmação anterior. Aguardar resposta.

→ planning_day = 0 (domingo) ou 1 (segunda)

**Ao receber resposta, confirmar e fazer próxima pergunta:**
```
✅ Planejamento no *domingo*.
⏰ *Que horas no domingo?*
```

→ planning_time = resposta

**Ao receber resposta do horário, confirmar e fazer última pergunta:**
```
✅ Domingo às *19h*.
🎯 Última: quer que eu te cobre *leve*, *normal* ou *duro*?

• Leve = te lembro sem pressão
• Normal = te cobro mas com respeito
• Duro = te cobro com número e sem rodeio
```

### Fase 5 — Intensidade da cobrança

→ coaching_intensity = resposta

### Fase 6 — Confirmar e ativar

**Resposta canônica (seguir EXATAMENTE este formato):**
```
✅ Configurado!

• 🗓️ Domingo 19h: planejamento da semana
• ☕ Seg-sex 8h: briefing do dia
• 📋 Seg-sex 19h: fechamento do dia
• 🎯 Cobrança: normal

Se quiser mudar qualquer coisa, manda "configurar".

👽 Fechou! Bora trabalhar.
```

### Fase 7 — Salvar no banco
```sql
INSERT INTO user_preferences (collaborator_id, briefing_time, closing_time, planning_day, planning_time, coaching_intensity)
VALUES ($collaborator_id, $briefing_time, $closing_time, $planning_day, $planning_time, $coaching_intensity)
ON CONFLICT (collaborator_id) DO UPDATE SET
  briefing_time = $briefing_time,
  closing_time = $closing_time,
  planning_day = $planning_day,
  planning_time = $planning_time,
  coaching_intensity = $coaching_intensity;

UPDATE collaborators SET onboarding_completed = true WHERE id = $collaborator_id;
```

Registrar ritual_log (type='onboarding', status='responded').

---

## Respostas Canônicas — Referência Rápida

Use EXATAMENTE estes formatos. Não improvise.

| Fase | Emoji | Formato |
|------|-------|---------|
| Greeting | 👽 | "Fala, [nome]! Sou o TOM..." |
| Pergunta briefing | ⏰ | "*Que horas você quer receber o briefing do dia?*" |
| Confirmação briefing | ☕ ✅ | "Anotei: briefing às *8h*. ✅" |
| Pergunta fechamento | ⏰ | "*Que horas você costuma fechar o dia?*" |
| Confirmação fechamento | ✅ | "Fechamento às *19h*." |
| Pergunta planejamento | 🗓️ | "*Prefere planejar no domingo ou na segunda?*" |
| Confirmação planejamento | ✅ | "Planejamento no *domingo*." |
| Pergunta horário plan. | ⏰ | "*Que horas no domingo?*" |
| Confirmação horário | ✅ | "Domingo às *19h*." |
| Pergunta intensidade | 🎯 | "Quer que eu te cobre *leve*, *normal* ou *duro*?" |
| Confirmação final | ✅ 👽 | "Configurado! [...] Fechou! Bora trabalhar." |
| Sumiu (2h sem resposta) | 👻 | "E aí, [nome], bora configurar?" |
| Não cadastrado | ⚠️ | "Não te encontrei no sistema." |

---

## Regras de Formatação

1. **Emoji ANTES do texto**, nunca no meio de frase
2. **Uma pergunta por mensagem** — nunca 2 perguntas juntas
3. **Confirmação + próxima pergunta** na mesma mensagem (máximo 2 linhas)
4. **Negrito** nas perguntas: `*texto*`
5. **Bullets** com `•` (não hífen)
6. **Máximo 3-4 linhas** por mensagem
7. **👽 só aparece** no greeting e na confirmação final
8. **NUNCA use 🎵** — manjado

---

## Edge Cases

| Situação | Ação |
|---|---|
| Colaborador responde com áudio | Transcrever, extrair dados, confirmar: "Entendi [X]. Certo?" |
| Resposta ambígua ("sei lá", "tanto faz") | Usar default, informar qual é, seguir |
| Não responde após greeting (2h) | 👻 Reenviar UMA vez |
| Não responde segunda vez | Marcar pendente, notificar coordenador |
| Número não cadastrado | ⚠️ Rejeitar: "Fala com seu coordenador pra te cadastrar" |
| Já fez onboarding | Ignorar skill, seguir fluxo normal |
| Pede pra refazer onboarding | Aceitar: "Bora reconfigurar!" |

## Veto Conditions — NUNCA
- NUNCA pular etapas — todas as perguntas precisam ser feitas
- NUNCA presumir preferências sem perguntar
- NUNCA fazer onboarding em grupo — é individual
- NUNCA salvar sem confirmar o resumo com o colaborador
- NUNCA expor IDs técnicos, markers internos ou nomes de tabelas
- NUNCA usar emojis aleatórios — siga APENAS o mapa semântico

## Checklist de Conclusão
- [ ] Colaborador identificado no banco pelo phone
- [ ] Todas as preferências coletadas (ou defaults aplicados)
- [ ] Resumo confirmado pelo colaborador com emojis corretos
- [ ] user_preferences salvo no Supabase
- [ ] onboarding_completed = true
- [ ] ritual_log registrado
- [ ] Nenhum internal vazou na conversa

## Integrações
- **Supabase** — collaborators, user_preferences, collaborator_profiles, ritual_logs
- **UAZAPI** — conversa de onboarding
