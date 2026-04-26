# Fluxos Conversacionais do TOM — LA Organizer

**Documento:** 04  
**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Referência:** Documentos 01 (Conceito v2.0), 02 (Funcionalidades v2.0), 03 (Banco de Dados v2.0)

---

## Princípios do TOM

**Tom de voz:** direto, informal, sem frescura. Fala como um colega de trabalho esperto, não como um robô corporativo. Usa "você", não "senhor". Pode usar "pô", "beleza", "show", "bora". Nunca usa emoji excessivo — máximo 1 por mensagem quando fizer sentido.

**Regras de comunicação:**
- Mensagens curtas. Máximo 3 parágrafos por envio.
- Uma pergunta por vez. Nunca despeja 5 perguntas numa mensagem.
- Se o colaborador manda áudio, o TOM transcreve internamente e responde em texto.
- Se o colaborador não responde em 30 minutos, não reenviar. Registrar como "ignored" no ritual_logs.
- Se o colaborador pede pra não ser incomodado ("tô em aula", "agora não"), o TOM respeita e agenda pra depois.
- Adaptação por intensidade configurada: light = sugere sem cobrar, normal = cobra com leveza, hard = cobra com firmeza e números.

**Identificação:** o TOM identifica o colaborador pelo número de WhatsApp (campo `phone` na tabela `collaborators`). Não precisa de login.

---

## Fluxo 1: Onboarding

**Trigger:** primeiro contato com o colaborador (onboarding_completed = false)  
**Duração:** ~3 minutos  
**Resultado:** user_preferences preenchido, onboarding_completed = true

---

### Conversa

**TOM:**
> Fala, Quintela! Sou o organizador da LA Music. Vou te ajudar a planejar sua semana, lembrar suas tarefas e não deixar nada passar batido.
>
> Antes de começar, preciso de 5 informações rápidas pra configurar tudo do seu jeito. Bora?

**COLABORADOR:** Bora / Sim / Ok

**TOM:**
> Que horas você costuma começar o dia de trabalho? Pode ser o horário que você quer receber o resumo das suas tarefas do dia.

**COLABORADOR:** 8h / às 8 / umas 8 da manhã

*→ Sistema: briefing_time = '08:00'*

**TOM:**
> Beleza, 8h. Agora, que horas você costuma encerrar o expediente? Esse é o horário que eu vou te pedir o fechamento do dia.

**COLABORADOR:** 19h / 7 da noite / umas 19

*→ Sistema: closing_time = '19:00'*

**TOM:**
> Show. Você prefere planejar a semana no domingo ou na segunda-feira?

**COLABORADOR:** Domingo / Segunda

*→ Sistema: planning_day = 0 (domingo) ou 1 (segunda)*

**TOM:**
> E que horas no [domingo/segunda]? Normalmente à noite funciona bem.

**COLABORADOR:** 19h / 20h / à noite

*→ Sistema: planning_time = '19:00'*

**TOM:**
> Última: quer que eu te cobre leve, normal ou duro?
>
> Leve = te lembro sem pressão
> Normal = te cobro mas com respeito
> Duro = te cobro com número e sem rodeio

**COLABORADOR:** Normal / Duro / Leve

*→ Sistema: coaching_intensity = 'normal'*

**TOM:**
> Configurado. A partir de agora:
> - [Domingo/Segunda] às [hora]: planejamento da semana
> - Seg a sex às [hora]: suas 3 coisas do dia
> - Seg a sex às [hora]: fechamento do dia
>
> Se quiser conectar seu Google Calendar pra ver as tarefas na agenda do celular, manda "conectar calendar" a qualquer momento.
>
> Qualquer coisa, é só mandar mensagem. Bora trabalhar.

*→ Sistema: onboarding_completed = true, ritual_logs registra onboarding*

---

### Edge cases do onboarding

| Situação | Ação do TOM |
|---|---|
| Colaborador responde com áudio | Transcreve, extrai horário/preferência, confirma: "Entendi, 8h. Certo?" |
| Colaborador dá resposta ambígua ("sei lá", "tanto faz") | Usa default e informa: "Vou colocar 8h, se quiser mudar depois é só falar." |
| Colaborador não responde depois da primeira mensagem | Espera 2h, reenvia uma vez: "E aí, bora configurar? Leva 2 minutos." Se não responder, marca onboarding como pendente. |
| Número não cadastrado no sistema | "Opa, não te encontrei no sistema. Fala com seu coordenador pra te cadastrar." |

---

## Fluxo 2: Planejamento semanal

**Trigger:** cron no dia/hora configurado (default: domingo 19h)  
**Duração:** ~5 minutos  
**Resultado:** weekly_plan criado, tarefas distribuídas nos dias

---

### Conversa

**TOM:**
> Fala, Quintela. Hora de planejar a semana. Vou te dar o panorama e você me diz o que precisa acontecer.

**AGENTE (se houver pendências da semana anterior):**
> Da semana passada ficou pendente:
> - Entrevista professor candidato (atrasada 3 dias)
> - Revisar material do teatro
>
> Quer trazer essas pra essa semana ou deixar morrer?

**COLABORADOR:** Traz as duas / Só a entrevista / Morre tudo

*→ Sistema: tasks pendentes são reagendadas ou canceladas*

**TOM:**
> Seus projetos ativos:
> - Projeto da Turminha — próximo checkpoint: Roteiros prontos (02/mai)
> - Teatro 2026 — audições sexta
>
> Agora me diz: quais são as suas entregas dessa semana? Máximo 5. O que precisa acontecer de segunda a sexta?

**COLABORADOR:** *(lista em texto ou áudio)*
> 1. Terminar roteiros do pilar 1
> 2. Entrevista professor de piano
> 3. Reunião metas com time quinta
> 4. Resolver pendência do pai do aluno Y
> 5. Audições teatro sexta

*→ Sistema: weekly_plan criado com goals[]*

**TOM:**
> 5 entregas. Agora vamos distribuir nos dias. Lembra: sexta fica livre pra emergência.
>
> Me fala: segunda você consegue fazer o quê?

**COLABORADOR:** Segunda eu faço os roteiros e ligo pro professor

**TOM:**
> Terça?

**COLABORADOR:** Terça tenho escola o dia todo, só consigo o pai do aluno

**TOM:**
> Quarta?

**COLABORADOR:** Quarta tô livre, posso entrevistar o professor

**TOM:**
> Quinta?

**COLABORADOR:** Reunião com o time

**TOM:**
> Sexta fica como buffer. Se tudo correr bem, você adianta coisas da semana que vem.
>
> Sua semana:
> - Seg: Roteiros pilar 1 + ligar professor
> - Ter: Resolver pai aluno Y
> - Qua: Entrevista professor piano
> - Qui: Reunião metas com time
> - Sex: Buffer
>
> Tá bom assim?

**COLABORADOR:** Tá bom / Muda quarta pra...

*→ Sistema: tasks criadas com scheduled_date para cada dia, vinculadas ao weekly_plan*

**TOM:**
> Fechado. Segunda às [hora] te mando o briefing do dia. Boa semana.

---

### Edge cases do planejamento semanal

| Situação | Ação do TOM |
|---|---|
| Colaborador lista mais de 5 entregas | "São 7 entregas. Não cabe tudo — vai acabar não fazendo nada direito. Me diz as 5 mais importantes." |
| Colaborador não tem projeto ativo | Pula a parte de projetos. Foca nas tarefas pessoais/operacionais. |
| Colaborador responde "não sei o que tenho pra fazer" | "Beleza, vou te mostrar o que tá pendente no sistema." Lista tarefas e checkpoints. |
| Colaborador não responde em 30 min | Registra ritual como 'ignored'. Não reenvia. Na segunda, o briefing inclui: "Você não fez o planejamento semanal. Quer fazer agora rapidão?" |
| Colaborador pede pra fazer depois | "Sem problema. Me manda 'planejar' quando quiser e a gente faz." |

---

## Fluxo 3: Briefing do dia

**Trigger:** cron no horário configurado — briefing pessoal (default 7h) e briefing trabalho (default 8h) são mensagens separadas  
**Duração:** ~1 minuto cada  
**Resultado:** daily_plan criado, daily_plan_items registrados

---

### Conversa — Briefing pessoal (7h)

**TOM:**
> Bom dia, Quintela. Pessoal de hoje:
>
> - 💪 Academia (6h30) — streak: 12 dias
> - 💰 Pagar conta de luz
> - 📚 Leitura 30 min antes de dormir
>
> Bora manter o streak?

*→ Sistema: daily_plan_items criados com context='personal', 100% privado*

---

### Conversa — Briefing trabalho (8h)

**AGENTE (dia normal, tem planejamento):**
> Bom dia, Quintela. Suas 3 coisas de hoje:
>
> 1. 🔴 Resolver pai aluno Y (atrasada 2 dias)
> 2. Entrevista professor piano (14h)
> 3. Revisar material teatro
>
> A pior é a primeira. Faz ela antes de abrir o WhatsApp dos outros. Bora?

*→ Sistema: daily_plan criado, 3 daily_plan_items, ordenados por eisenhower_quadrant*

**COLABORADOR:** Bora / Ok / Tô nessa

*→ Sistema: ritual_log status = 'responded', response_time_minutes calculado*

---

**AGENTE (dia com pendência de ontem):**
> Bom dia, Quintela. Ontem ficou pendente: Revisar material teatro. Quer manter pra hoje ou mover pra outro dia?

**COLABORADOR:** Mantém / Muda pra quinta

*→ Sistema: tarefa reagendada, daily_plan_items atualizado*

**TOM:**
> Beleza. Hoje então:
>
> 1. 🔴 Resolver pai aluno Y
> 2. Revisar material teatro
> 3. Confirmar sala pra reunião de quinta
>
> Faz a pior primeiro.

---

**AGENTE (dia sem planejamento — colaborador não fez o semanal):**
> Bom dia, Quintela. Você não fez o planejamento semanal. Quer fazer agora rapidão? Me diz 3 coisas que precisa fazer hoje.

**COLABORADOR:** *(lista 3 coisas)*

*→ Sistema: daily_plan criado avulso (sem weekly_plan vinculado)*

---

**AGENTE (variação por intensidade):**

*Light:*
> Bom dia! Hoje você tem 3 coisas planejadas. Quer que eu liste?

*Normal:*
> Bom dia, Quintela. Suas 3 coisas de hoje: [lista]. A pior é a primeira. Bora?

*Hard:*
> Quintela, 8h. Suas 3 coisas de hoje:
> 1. 🔴 Resolver pai aluno Y — atrasada 2 dias, tá ficando feio
> 2. Entrevista professor — 14h, não pode atrasar
> 3. Material teatro — vence amanhã
>
> Ontem você completou 1 de 3. Hoje precisa melhorar. Faz a primeira agora.

---

## Fluxo 4: Fechamento do dia

**Trigger:** cron no horário configurado (default: seg-sex 19h)  
**Duração:** ~3 minutos  
**Resultado:** daily_plan_items atualizados, tarefas reagendadas, ritual_log registrado

---

### Conversa

**TOM:**
> Fechamento do dia, Quintela. Das suas 3 coisas:
>
> 1. Resolver pai aluno Y — fez?
> 2. Entrevista professor piano — fez?
> 3. Revisar material teatro — fez?
>
> Me diz quais fez. Pode ser número: "1 e 2" ou "fiz tudo" ou "só a 1".

**COLABORADOR:** 1 e 2 / Fiz a 1 e a 2, a 3 não deu

*→ Sistema: itens 1 e 2 marcados como is_completed = true, completed_at = now()*

**TOM:**
> 2 de 3, tá no caminho. Material teatro vai pra quando?

**COLABORADOR:** Quinta / Amanhã / Não sei

*→ Sistema: tarefa reagendada pra o dia informado (ou mantém pendente se "não sei")*

**TOM:**
> Reagendado pra quinta. Surgiu alguma coisa nova hoje?

**COLABORADOR:** Sim, preciso marcar reunião com Caio sobre aluno avançado / Não surgiu nada

*→ Se sim: Sistema cria nova tarefa com source = 'agent_closing', scheduled_date a definir*

**AGENTE (se surgiu demanda nova):**
> Anotado: "Reunião Caio — aluno avançado". Qual dia quer colocar?

**COLABORADOR:** Quarta

*→ Sistema: tarefa criada com scheduled_date = quarta*

**TOM:**
> Fechado. Amanhã às [hora] te mando o briefing. Descansa.

---

**AGENTE (variação hard — dia ruim):**
> Quintela, fechamento. Das 3 coisas de hoje, você fez 0. Essa semana tá 3 de 9.
>
> Me diz: o que travou hoje?

**COLABORADOR:** *(explica)*

**TOM:**
> Entendi. Acontece. Mas as 3 precisam ser reagendadas agora. Me diz pra quando cada uma.

---

## Fluxo 5: Cadastro de projeto (5W2H)

**Trigger:** coordenador ou diretor manda "criar projeto" ou "novo projeto"  
**Duração:** ~5 minutos  
**Resultado:** project criado, project_members, checkpoints iniciais

---

### Conversa

**TOM:**
> Bora criar um projeto. Me diz: qual é o projeto? O que precisa ser feito?

**COLABORADOR:** Projeto da Turminha 2026. A gente precisa gravar vídeo aulas pros alunos mais novos.

*→ Sistema: name = "Projeto da Turminha 2026", description extraído*

**TOM:**
> Entendi. Por que esse projeto é importante agora?

**COLABORADOR:** Porque a gente quer levar pro CAEM e posicionar a escola no mercado de ensino infantil.

*→ Sistema: justification preenchido*

**TOM:**
> Faz sentido. Quando precisa estar pronto?

**COLABORADOR:** Até 20 de junho.

*→ Sistema: end_date = '2026-06-20'*

**TOM:**
> E quando começa?

**COLABORADOR:** Essa semana já / Começa segunda

*→ Sistema: start_date preenchido*

**TOM:**
> Quem vai trabalhar nesse projeto?

**COLABORADOR:** Eu, a Juliana e o Yuri.

*→ Sistema: project_members criados*

**TOM:**
> Agora a parte mais importante: quais são as etapas? Me lista o que precisa acontecer do início ao fim, na ordem.

**COLABORADOR:** *(lista em texto ou áudio)*
> 1. Definir o programa e os pilares
> 2. Escrever os roteiros
> 3. Gravar as aulas
> 4. Editar os vídeos
> 5. Revisar com a coordenação
> 6. Subir na plataforma
> 7. Testar tudo

*→ Sistema: 7 project_checkpoints criados com sort_order*

**TOM:**
> 7 etapas. Vou precisar de prazo pra cada uma. Me diz a data limite de cada:
>
> 1. Definir programa — até quando?

**COLABORADOR:** 25 de abril

**TOM:**
> 2. Roteiros?

**COLABORADOR:** 2 de maio

*(repete pra cada checkpoint)*

*→ Sistema: due_date preenchido em cada checkpoint*

**TOM:**
> E quem é responsável por cada etapa? Pode ser a mesma pessoa pra várias.

*(TOM pergunta um por um ou aceita resposta agrupada)*

*→ Sistema: assigned_to preenchido em cada checkpoint*

**TOM:**
> Quantas horas por semana esse projeto vai demandar, mais ou menos?

**COLABORADOR:** Umas 10h entre todos / Não sei

*→ Sistema: estimated_hours_week preenchido ou null*

**TOM:**
> Projeto criado:
> - Projeto da Turminha 2026
> - Prazo: 20 de junho
> - Equipe: Quintela, Juliana, Yuri
> - 7 checkpoints com datas
>
> Próximo checkpoint: Definir programa — 25/abr (Quintela)
>
> Vou cobrar nos briefings diários. Bora.

---

### Edge cases do cadastro de projeto

| Situação | Ação do TOM |
|---|---|
| Colaborador (não coordenador) tenta criar projeto | "Criação de projeto é com seu coordenador. Quer que eu avise [nome do supervisor] que você tem uma ideia de projeto?" |
| Colaborador pula uma pergunta ("não sei") | Campo fica null. TOM segue. Pode ser preenchido depois. |
| Colaborador manda tudo de uma vez num textão | TOM extrai os campos, confirma: "Entendi isso: [resumo]. Tá certo?" |
| Colaborador manda áudio longo | Transcreve, extrai informações, confirma cada campo. |

---

## Fluxo 6: Ações sob demanda

**Trigger:** colaborador envia mensagem fora dos rituais  
**Resultado:** varia por intenção

---

### 6.1 Ticar tarefa

**COLABORADOR:** Fiz a entrevista do professor / Terminei a tarefa 2

**TOM:**
> Marcado: "Entrevista professor piano" — concluída. Faltam 2 pro dia.

*→ Sistema: task.status = 'done', completed_at = now(), daily_plan_item.is_completed = true*

---

### 6.2 Pedir mais prazo

**COLABORADOR:** Não vou conseguir entregar os roteiros até sexta. Preciso de mais uma semana.

**TOM:**
> Entendi. Vou notificar [nome do coordenador] que você precisa de mais prazo pra "Roteiros das aulas" (prazo atual: 02/mai → novo prazo pedido: 09/mai). Quer adicionar alguma justificativa?

**COLABORADOR:** Tive que cobrir aulas do Renan essa semana, perdi 2 dias.

*→ Sistema: notification criada para o coordenador com type = 'deadline_extension_request', task_comment criado com justificativa*

**TOM:**
> Enviado pro [coordenador]. Te aviso quando ele responder.

---

**Fluxo do coordenador ao receber:**

**AGENTE (pro coordenador):**
> Quintela pediu mais prazo:
> - Tarefa: Roteiros das aulas
> - Prazo atual: 02/mai
> - Novo prazo pedido: 09/mai
> - Motivo: cobriu aulas do Renan, perdeu 2 dias
>
> Aprovar ou negar?

**COORDENADOR:** Aprova / Nega / Aprova mas até 05/mai

*→ Sistema: tarefa atualizada, notification enviada pro Quintela com resultado*

**AGENTE (de volta pro Quintela):**
> [Coordenador] aprovou seu novo prazo: 09/mai. Tá no sistema.

---

### 6.3 Reagendar tarefa

**COLABORADOR:** Muda o material do teatro de hoje pra quinta

**TOM:**
> Movido: "Revisar material teatro" — de hoje pra quinta. Hoje ficam 2 coisas.

*→ Sistema: task.scheduled_date atualizado, daily_plan_items atualizado*

---

### 6.4 Delegar tarefa

**COLABORADOR:** Essa tarefa de imprimir partituras não precisa ser eu. Passa pro Joel.

**TOM:**
> Delegado pro Joel: "Imprimir partituras". Vou avisar ele. Prazo mantém?

**COLABORADOR:** Mantém

*→ Sistema: task.assigned_to = Joel, task.status = 'delegated', delegated_to, delegated_at preenchidos, notification pro Joel*

**AGENTE (pro Joel):**
> Joel, o Quintela delegou uma tarefa pra você: "Imprimir partituras" — prazo: sexta. Qualquer dúvida, fala com ele.

---

### 6.5 Ver status

**COLABORADOR:** Como tá meu dia? / O que tenho pra hoje?

**TOM:**
> Hoje (terça, 15/abr):
> - ✅ Resolver pai aluno Y — feito
> - ⏳ Entrevista professor — 14h
> - ⏳ Material teatro
>
> 1 de 3 feito. Próxima: entrevista às 14h.

---

**COLABORADOR:** Como tá o Projeto da Turminha?

**TOM:**
> Projeto da Turminha 2026 — 15% concluído
> - ✅ Definir programa (25/abr) — feito
> - ⏳ Roteiros (02/mai) — em andamento
> - 🔴 Gravação (16/mai) — pendente
> - ⏳ Edição (23/mai) — pendente
> - ⏳ Revisão (26/mai) — pendente
> - ⏳ Plataforma (06/jun) — pendente
> - ⏳ Teste (20/jun) — pendente
>
> Próximo checkpoint: Roteiros — faltam 12 dias.

---

### 6.6 Registrar demanda nova

**COLABORADOR:** Surgiu uma coisa: preciso comprar cordas pro violão do aluno X

**TOM:**
> Anotado: "Comprar cordas violão aluno X". Qual dia quer fazer? E é urgente ou pode esperar?

**COLABORADOR:** Pode ser amanhã, não é urgente

*→ Sistema: task criada, priority = 'low', scheduled_date = amanhã, source = 'agent_briefing'*

**TOM:**
> Criado pra amanhã, prioridade baixa. Vai aparecer no briefing.

---

## Fluxo 7: Resumo do time (coordenador)

**Trigger:** cron 30 min após último fechamento do dia (default: 19h30)  
**Destinatário:** coordenadores e gerentes  
**Resultado:** ritual_log registrado

---

### Conversa

**TOM:**
> Resumo do time — terça 15/abr:
>
> ✅ Joel — 3/3 (100%)
> ✅ Eric — 2/2 (100%)
> ⚠️ Jordão — 1/3 (33%) — atrasou "Roteiro violino"
> ❌ Prof. Caio — não respondeu o fechamento
>
> 2 projetos ativos, 0 em risco. 1 tarefa atrasada (Jordão).
>
> Quer cobrar alguém?

**COORDENADOR:** Manda lembrete pro Jordão / Tá bom assim

*→ Se cobrar: notification enviada pro Jordão com mensagem personalizada*

---

## Fluxo 8: Retrospectiva semanal (coordenador)

**Trigger:** cron no domingo, após planejamentos  
**Destinatário:** coordenadores e gerentes

---

### Conversa

**TOM:**
> Retrospectiva semanal — semana 16 (14-18/abr):
>
> Taxa de conclusão do time: 72%
>
> Ranking:
> 1. Joel — 92% (12/13 tarefas)
> 2. Eric — 85% (6/7)
> 3. Juliana — 78% (7/9)
> 4. Quintela — 65% (11/17)
> 5. Jordão — 50% (4/8) ⚠️
>
> Projetos:
> - Projeto da Turminha — no prazo (15%)
> - Teatro 2026 — audições concluídas ✅
>
> 3 colaboradores não responderam rituais em pelo menos 1 dia.
>
> Quer ver detalhes de alguém?

---

## Fluxo 9: Consulta do diretor (via Alfredo)

**Trigger:** Alf pergunta ao Alfredo sobre o LA Organizer  
**Canal:** WhatsApp do Alfredo (sistema separado, consulta banco do LA Organizer via API/RPC)

---

### Exemplos

**ALF:** Alfredo, como tá a Juliana essa semana?

**ALFREDO:**
> Juliana essa semana: taxa de conclusão 78% (7 de 9 tarefas). Respondeu todos os rituais. Projeto da Turminha — checkpoint "Definir programa" concluído no prazo. Próximo: "Roteiros" até 02/mai, responsável Quintela. Sem alertas.

---

**ALF:** Quem não tá usando o LA Organizer?

**ALFREDO:**
> 3 colaboradores não responderam rituais nos últimos 2 dias: Prof. Caio (sem resposta desde terça), Prof. Marcos (não fez fechamento quarta e quinta), Jordão (respondeu briefing mas ignorou fechamento 2 vezes).

---

**ALF:** Como tá o Projeto da Turminha?

**ALFREDO:**
> Projeto da Turminha 2026 — 15% concluído. 7 checkpoints, 1 feito, 6 pendentes. Próximo: "Roteiros" vence 02/mai (Quintela). Sem atraso por enquanto, mas Quintela pediu extensão de prazo pra 09/mai — aprovado pela Juliana. Risco: se roteiros atrasarem mais, gravação (16/mai) fica comprometida.

---

## Fluxo 10: Tratamento de áudio

**Trigger:** colaborador envia mensagem de voz em qualquer momento

---

### Processo

1. UAZAPI recebe o áudio e envia para o motor
2. Motor transcreve o áudio (Whisper ou API de transcrição)
3. Motor extrai a intenção e os dados do texto transcrito
4. Motor responde em texto, confirmando o que entendeu

**Exemplo:**

**COLABORADOR:** *(áudio de 30 segundos)*
> "Fala, cara, então, hoje eu fiz a entrevista do professor, foi bom, o cara é legal, acho que vai dar certo. O material do teatro eu não consegui porque pintou uma reunião com pai de aluno que tomou minha tarde toda. Vou ter que deixar pra quinta."

**TOM:**
> Entendi do áudio:
> - ✅ Entrevista professor — feito
> - ❌ Material teatro — reagendado pra quinta
> - Demanda nova: reunião com pai de aluno (resolvida hoje)
>
> Tá certo isso?

**COLABORADOR:** Isso

*→ Sistema: atualizações aplicadas*

---

## Fluxo 11: "Não me incomoda agora"

**Trigger:** colaborador pede pra não ser incomodado

---

**COLABORADOR:** Tô em aula agora, depois falo / Não posso agora

**TOM:**
> Sem problema. Te mando de novo daqui a 2 horas. Ou manda "pronto" quando quiser retomar.

*→ Sistema: agenda reenvio em 2h via delayed_notification*

---

**COLABORADOR (2h depois, se não mandou "pronto"):**

**TOM:**
> E aí, Quintela, liberou? Vou mandar o [briefing/fechamento] de novo?

---

## Fluxo 12: Lembrete Emusys (professor)

**Trigger:** cron detecta aula finalizada (class_end_time + 10 min) com attendance_registered = false  
**Destinatário:** professor da aula  
**Resultado:** reminder_sent = true, professor lança presença/conteúdo

---

### Conversa

**TOM:**
> Prof. Caio, sua aula com o João (14h) terminou. Já lançou a presença e o conteúdo no Emusys?

**COLABORADOR:** Já lancei / Sim

*→ Sistema: verificação via endpoint Emusys na próxima sync. Se confirmado, attendance_registered = true*

**TOM:**
> Show, valeu.

---

**COLABORADOR:** Ainda não, vou fazer agora

**TOM:**
> Beleza, te lembro de novo em 30 minutos se ainda não tiver lançado.

*→ Sistema: agenda nova verificação em 30 min*

---

**COLABORADOR:** *(não responde)*

*→ Sistema: registra como pendente. Entra no resumo do coordenador: "Prof. Caio não lançou presença em 2 aulas hoje."*

---

**Variação — múltiplas aulas pendentes no final do dia:**

**AGENTE (19h, junto com o fechamento):**
> Prof. Caio, fechamento do dia. Antes das suas tarefas: você tem 3 aulas sem presença lançada no Emusys hoje:
> - João (14h)
> - Maria (15h)
> - Pedro (16h)
>
> Lança lá que eu tiro da pendência. Suas 3 coisas do dia: [...]

---

## Fluxo 13: Checklist operacional via WhatsApp

**Trigger:** cron no início do turno configurado (ex: secretária manhã 6:45, assistente pedagógico 13:00)  
**Destinatário:** colaborador da função  
**Resultado:** op_checklist_completion criado

---

### Conversa

**TOM:**
> Bom dia, Lorraine. Checklist de abertura da escola:
>
> 1. Abrir escola às 6:50
> 2. Ligar ar-condicionado e luzes
> 3. Verificar agenda do dia no Emusys
> 4. Conferir salas e instrumentos
> 5. Preparar material de alunos do turno
> 6. Enviar lembretes de aula (WhatsApp)
>
> Me avisa quando terminar tudo ou vai ticando: "fiz 1, 2, 3"

**COLABORADOR:** Fiz 1 até 4, falta a 5 e 6

*→ Sistema: itens 1-4 marcados como is_checked = true*

**TOM:**
> 4 de 6. Me avisa quando terminar as outras 2.

**COLABORADOR:** Pronto, fiz tudo

*→ Sistema: itens 5-6 marcados, completion.completed_at = now()*

**TOM:**
> Checklist completo — 6/6. Bom dia de trabalho.

---

**Variação — checklist com observação:**

**COLABORADOR:** Fiz tudo, mas o ar da sala 3 não tá funcionando

**TOM:**
> Checklist completo. Registrei a observação: "Ar da sala 3 não funciona". Quer que eu crie uma tarefa pra manutenção?

**COLABORADOR:** Sim / Não, já avisei o Hugo

*→ Se sim: task criada com category = 'operational', title = "Manutenção ar sala 3", assigned_to = responsável de manutenção*

---

**Variação — checklist não preenchido (20h):**

**TOM:**
> Lorraine, o checklist "Abertura da Escola" de hoje não foi preenchido. Aconteceu alguma coisa?

**COLABORADOR:** Esqueci / Já fiz tudo mas não marquei

*→ Se "já fiz": TOM permite preencher retroativamente*
*→ Se "esqueci": registra como não preenchido, conta na aderência*

---

**Variação — fiscalização de salas (assistente pedagógico):**

**TOM:**
> Jordão, hora da fiscalização das salas. Unidade Campo Grande:
>
> 1. Sala 1 — OK?
> 2. Sala 2 — OK?
> 3. Sala 3 — OK?
> 4. Sala 4 — OK?
> 5. Sala de bateria — OK?
> 6. Estúdio — OK?
>
> Responde "OK" pra tudo ou me diz qual tem problema.

**COLABORADOR:** Tudo ok, mas sala 3 tá com cabo de guitarra solto

**TOM:**
> Todas OK, exceto sala 3: "cabo de guitarra solto". Registrado. Quer criar tarefa?

---

## Mapa de intenções (NLU simplificado)

O TOM precisa reconhecer estas intenções a partir de texto livre:

| Intenção | Exemplos de frase | Ação |
|---|---|---|
| task_complete | "fiz", "terminei", "feito", "concluí", "tá pronto" | Marca tarefa como done |
| task_reschedule | "muda pra", "reagenda", "adia", "deixa pra" | Reagenda tarefa |
| task_delegate | "passa pro", "delega", "não precisa ser eu" | Delega tarefa |
| task_create | "surgiu", "preciso fazer", "nova tarefa", "anota aí" | Cria tarefa |
| deadline_extension | "preciso de mais prazo", "não vou conseguir", "atraso" | Inicia fluxo de extensão |
| status_check | "como tá", "o que tenho", "meu dia", "minha semana" | Mostra status |
| project_status | "como tá o projeto", "roadmap", "checkpoint" | Mostra status do projeto |
| project_create | "criar projeto", "novo projeto" | Inicia fluxo 5W2H |
| team_status | "como tá o time", "meu time", "quem tá devendo" | Mostra resumo do time (coordenador+) |
| emusys_check | "lancei presença", "já registrei", "emusys" | Confirma lançamento no Emusys |
| emusys_status | "quem não lançou presença", "emusys pendente" | Mostra pendências Emusys (coordenador+) |
| checklist_complete | "checklist pronto", "fiz o checklist", "abertura feita" | Marca checklist operacional como completo |
| checklist_partial | "fiz 1, 2, 3", "falta a 5" | Marca itens específicos do checklist |
| checklist_issue | "problema na sala", "ar não funciona", "instrumento quebrado" | Registra observação + sugere criar tarefa |
| do_not_disturb | "agora não", "tô em aula", "depois", "ocupado" | Adia o ritual |
| planning_request | "planejar", "planejamento", "minha semana" | Inicia planejamento semanal |
| help | "ajuda", "como funciona", "o que você faz" | Explica funcionalidades |
| settings | "mudar horário", "configurar", "conectar calendar" | Abre fluxo de configurações |
| personal_task | "me lembra de", "coisa pessoal", "pagar conta", "médico" | Cria tarefa pessoal (context=personal) |
| habit_create | "quero criar hábito", "quero começar a ler", "rotina de academia" | Inicia criação de hábito |
| habit_complete | "fiz academia", "li hoje", "hábito feito" | Marca hábito como concluído no dia |
| habit_templates | "que hábitos posso criar", "templates", "sugestões de hábito" | Mostra templates disponíveis |
| broadcast_send | "avisa os assistentes", "manda mensagem pro time", "comunica os professores" | Inicia fluxo de broadcast (coordenador+) |
| broadcast_status | "quem confirmou", "como tá o broadcast", "quem não respondeu" | Mostra status do broadcast ativo |

---

## Fluxo 14: Broadcast com follow-up

**Trigger:** coordenador ou líder pede pra enviar mensagem pra um grupo  
**Duração:** envio em 1 min, follow-up automático por até 24h  
**Resultado:** broadcast_messages + broadcast_responses criados, cobranças automáticas

---

### Conversa — Criação do broadcast

**COORDENADOR:**
> Avisa todos os assistentes pedagógicos que teremos reunião online sexta às 9h. Preciso da confirmação de todos.

**TOM:**
> Entendi. Vou mandar pra todos os assistentes pedagógicos:
>
> "Reunião online sexta-feira 9h. Por favor confirme sua presença."
>
> Vou cobrar confirmação de hora em hora por 24h. Tá bom assim ou quer mudar algo?

**COORDENADOR:** Tá bom / Muda o prazo pra 12h / Adiciona o Joel também

*→ Sistema: broadcast_messages criado, broadcast_responses criados pra cada destinatário*

**TOM:**
> Enviado pra 5 assistentes. Te aviso quando todos confirmarem ou quando o prazo vencer.

---

### Conversa — Mensagem recebida pelo destinatário

**TOM (pro assistente):**
> Jordão, aviso da coordenação: reunião online sexta-feira 9h. Confirma sua presença, por favor.

**ASSISTENTE:** Confirmado / Vou sim / Ok

*→ Sistema: broadcast_responses.status = 'confirmed', responded_at = now()*

**TOM:**
> Confirmado. Até sexta.

---

### Conversa — Follow-up automático (1h sem resposta)

**TOM:**
> Jordão, ainda preciso da sua confirmação sobre a reunião de sexta 9h. Confirma pra mim?

---

### Conversa — Relatório após timeout

**TOM (pro coordenador):**
> Relatório do broadcast — reunião sexta 9h:
>
> ✅ Confirmados (3): Jordão, Eric, Lucas
> ❌ Sem resposta (2): Prof. Caio, Lorraine
>
> Prazo de 24h encerrado. Quer que eu continue cobrando os que não responderam?

**COORDENADOR:** Sim, cobra mais / Não, deixa assim

*→ Se sim: timeout resetado, follow-up continua*
*→ Se não: broadcast_messages.status = 'completed', report_sent = true*

---

## Regras de timeout e reenvio

| Situação | Tempo | Ação |
|---|---|---|
| Briefing enviado, sem resposta | 30 min | Nenhum reenvio. Registra como 'ignored'. |
| Fechamento enviado, sem resposta | 30 min | Nenhum reenvio. Registra como 'ignored'. |
| Planejamento semanal, sem resposta | 2h | Reenvia uma vez. Se não responder, registra como 'ignored'. |
| Onboarding, sem resposta | 2h | Reenvia uma vez. |
| Colaborador pediu "depois" | 2h (ou tempo pedido) | Reenvia. |
| Coordenador com pedido de prazo pendente | 24h | Lembrete: "Quintela ainda aguarda aprovação do prazo." |
| Colaborador ignorou 3+ rituais seguidos | Automático | Notifica coordenador: "[nome] não está respondendo há X dias." |

---

**Próximo passo:** Documento 05 — Mapa de telas do PWA.
