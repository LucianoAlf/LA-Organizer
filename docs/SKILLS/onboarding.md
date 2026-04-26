---
name: onboarding
description: Skill para conduzir a primeira conversa com um novo colaborador — configurar preferências, explicar o TOM, e ativar o sistema. Use quando onboarding_completed = false e o colaborador mandar a primeira mensagem, ou quando o TOM enviar a primeira mensagem proativa.
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
```
Fala, [nome]! Sou o TOM — vou te ajudar a organizar seu dia, lembrar suas tarefas e não deixar nada passar batido. Tanto no trabalho quanto na vida pessoal.

Preciso de algumas informações rápidas pra configurar tudo do seu jeito. Leva 2 minutos. Bora?
```

Aguardar confirmação ("bora", "sim", "ok", "vamos").

Se não responder em 2h: reenviar UMA vez: "E aí, [nome], bora configurar? Leva 2 minutos."
Se não responder de novo: marcar onboarding como pendente, notificar coordenador.

### Fase 2 — Horário do briefing pessoal
```
Primeiro: que horas você costuma acordar ou começar o dia? Esse vai ser o horário que eu mando seus compromissos pessoais (academia, contas, hábitos).
```

Respostas aceitas: "7h", "às 7", "umas 7 da manhã", "7:00", "sete"
→ personal_briefing_time = '07:00'

Se ambíguo: "Entendi 7h. Certo?"
Se "tanto faz": usar default 7h e informar: "Vou colocar 7h. Se quiser mudar depois, é só falar."

### Fase 3 — Horário do briefing de trabalho
```
Agora, que horas começa seu expediente? Esse é o horário que eu mando suas tarefas de trabalho.
```

→ briefing_time = resposta

### Fase 4 — Horário do fechamento
```
E que horas você costuma encerrar o dia de trabalho? Nesse horário eu te peço o fechamento do dia.
```

→ closing_time = resposta

### Fase 5 — Dia do planejamento semanal
```
Prefere planejar a semana no domingo ou na segunda-feira?
```

→ planning_day = 0 (domingo) ou 1 (segunda)

Se domingo: "E que horas no domingo?"
Se segunda: "E que horas na segunda?"

→ planning_time = resposta

### Fase 6 — Quantidade de tarefas por dia
```
Quantas coisas por dia você consegue resolver de verdade? A maioria do time trabalha com 3, mas pode ser 2, 4 ou 5 — o importante é ser realista.
```

→ max_daily_tasks = resposta (entre 1 e 7, default 3)

Se o cara falar "10": "10 é muita coisa. O objetivo não é listar tudo — é terminar tudo. Quer manter 10 ou ajustar?"

### Fase 7 — Intensidade da cobrança
```
Última: quer que eu te cobre leve, normal ou duro?

Leve = te lembro sem pressão
Normal = te cobro mas com respeito
Duro = te cobro com número e sem rodeio
```

→ coaching_intensity = resposta

### Fase 8 — Google Calendar (opcional)
```
Quer conectar seu Google Calendar pra ver suas tarefas na agenda do celular? Se sim, te mando o link. Se não, sem problema — pode conectar depois.
```

Se sim: enviar link OAuth
Se não: seguir

### Fase 9 — Confirmar e ativar
```
Configurado, [nome]! Resumo:

- Pessoal: [personal_briefing_time]
- Trabalho: [briefing_time]
- Fechamento: [closing_time]
- Planejamento: [dia] às [planning_time]
- Tarefas por dia: [max_daily_tasks]
- Cobrança: [coaching_intensity]
- Google Calendar: [conectado/não conectado]

A partir de agora:
- [Dia] às [hora]: planejamento da semana
- Seg a sex às [hora]: suas coisas pessoais
- Seg a sex às [hora]: suas tarefas de trabalho
- Seg a sex às [hora]: fechamento do dia

Se quiser mudar qualquer coisa, manda "configurar". Bora trabalhar. 🎵
```

### Fase 10 — Salvar e ativar
```sql
UPDATE user_preferences SET
  personal_briefing_time = $1,
  briefing_time = $2,
  closing_time = $3,
  planning_day = $4,
  planning_time = $5,
  max_daily_tasks = $6,
  coaching_intensity = $7
WHERE collaborator_id = $collaborator_id;

UPDATE collaborators SET onboarding_completed = true WHERE id = $collaborator_id;
```

Registrar ritual_log (type='onboarding', status='responded').

## Edge Cases

| Situação | Ação |
|---|---|
| Colaborador responde com áudio | Transcrever, extrair dados, confirmar: "Entendi [X]. Certo?" |
| Resposta ambígua ("sei lá", "tanto faz") | Usar default, informar qual é, seguir |
| Não responde após greeting (2h) | Reenviar UMA vez |
| Não responde segunda vez | Marcar pendente, notificar coordenador |
| Número não cadastrado | Rejeitar: "Fala com seu coordenador pra te cadastrar" |
| Já fez onboarding | Ignorar skill, seguir fluxo normal |
| Pede pra refazer onboarding | Aceitar: "Bora reconfigurar. Que horas começa teu dia?" |

## Veto Conditions — NUNCA
- NUNCA pular etapas — todas as perguntas precisam ser feitas
- NUNCA presumir preferências sem perguntar
- NUNCA aceitar max_daily_tasks > 7 sem empurrar de volta
- NUNCA fazer onboarding em grupo — é individual
- NUNCA salvar sem confirmar o resumo com o colaborador

## Checklist de Conclusão
- [ ] Colaborador identificado no banco pelo phone
- [ ] Todas as 7 preferências coletadas (ou defaults aplicados)
- [ ] Google Calendar oferecido (aceite ou recusa registrado)
- [ ] Resumo confirmado pelo colaborador
- [ ] user_preferences salvo no Supabase
- [ ] collaborator_profiles criado (trigger automático)
- [ ] onboarding_completed = true
- [ ] ritual_log registrado

## Integrações
- **Supabase** — collaborators, user_preferences, collaborator_profiles, ritual_logs
- **UAZAPI** — conversa de onboarding
- **Google Calendar API** — link OAuth (opcional)
