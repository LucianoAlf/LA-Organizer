'use strict';
// SKILL-ROUTER-QUOTE-CONTAMINATION (Quintela, 12/08 13:17 e 13/08 13:04 BRT).
//
// Ele respondeu à cobrança do checklist da tarefa "Onboard professora nova" pedindo pra marcar
// dois itens como feitos. Nas DUAS vezes o TOM emitiu <<CHECKLIST_ACTION>> (marker do checklist
// OPERACIONAL do cron, que exige completion_id) em vez de <<TASK_UPDATE>> action:"mark-item" —
// o marker do checklist de TAREFA (filha via parent_task_id). marker_logs registrou
// `CHECKLIST_ACTION rejected schema_invalid` nos dois turnos, nada persistiu, e o chokepoint
// devolveu "_não consegui registrar isso agora — me manda de novo_". Ele mandou de novo no dia
// seguinte e levou a MESMA resposta: beco.
//
// Causa: o webhook prepende o scaffold de reply-quote
//   [O usuário está RESPONDENDO a esta mensagem anterior: "<mensagem do TOM>"]\n<fala real>
// e os roteadores de CONTEXTO do pickSkill (gerencia 4.65 / pedagogico 4.7 / operacoes-tecnicas
// 4.8) casavam no texto CRU. A cobrança do TOM cita o título da tarefa — "Onboard *professora*
// nova" — então "professora" ligava o pedagogico, que tem prioridade sobre o checklist-tarefas
// (priority 5). A skill que ensina `mark-item` nunca era carregada e o LLM improvisava o marker.
//
// Mesma família dos fixes AUTO-ALIGN-QUOTE-CONTAMINATION e FINEDIT-QUOTE-SCAFFOLD-MISROUTE:
// detector determinístico tem que ler a FALA REAL, nunca o scaffold. Aqui o strip vale SÓ para
// os roteadores de TÓPICO — medido em 215 reply-quotes de produção, aplicar o strip no pickSkill
// inteiro mudaria 133 e jogaria 94 em skill nenhuma, que é pior que a skill errada.

const test = require('node:test');
const assert = require('node:assert');
const { pickSkill } = require('./system');

const COLLAB = { id: '00000000-0000-0000-0000-000000000001', full_name: 'Quintela', role: 'collaborator' };

const COBRANCA_CHECKLIST = '🚨 *Onboard professora nova* tá há 5 dias sem mexer. Não dá mais pra ignorar — me dá um sinal. Texto, áudio, qualquer coisa.\n\n*Checklist:* 1/5 ▓░░░░\n✅ Jornanda do Aluno\n⬜ Emusys\n⬜ Cultura\n⬜ Dress Code\n⬜ Codigo de conduta';

const comQuote = (citacao, fala) => `[O usuário está RESPONDENDO a esta mensagem anterior: "${citacao}"]\n${fala}`;

test('caso Quintela 13/08: "professora" vem do título citado, não da fala — carrega checklist-tarefas', async () => {
  const raw = comQuote(COBRANCA_CHECKLIST, 'Ja falei pra colocar dress code e emusys como feito');
  const skill = await pickSkill(COLLAB, raw, []);
  assert.strictEqual(skill && skill.name, 'checklist-tarefas');
});

test('a fala real sozinha já roteava certo — o scaffold é que desviava', async () => {
  const skill = await pickSkill(COLLAB, 'Ja falei pra colocar dress code e emusys como feito', []);
  assert.strictEqual(skill && skill.name, 'checklist-tarefas');
});

// Os dois irmãos do mesmo bloco de prioridade têm o buraco idêntico: roteiam por palavra de
// TÓPICO, e o TOM cita títulos de tarefa o tempo todo nas cobranças.
test('irmão gerencia (4.65): "recepção" citada pelo TOM não sequestra a fala de conclusão', async () => {
  const raw = comQuote('🔴 *Ajustar escala da recepção* atrasou 1 dia. Resolve hoje ou reagenda?', 'fiz ontem');
  const skill = await pickSkill(COLLAB, raw, []);
  assert.strictEqual(skill && skill.name, 'checklist-tarefas');
});

test('irmão operacoes-tecnicas (4.8): "equipamento" citado pelo TOM não sequestra a fala', async () => {
  const raw = comQuote('🔴 *Revisar equipamento da sala 2* atrasou 1 dia. Resolve hoje ou reagenda?', 'terminei');
  const skill = await pickSkill(COLLAB, raw, []);
  assert.strictEqual(skill && skill.name, 'checklist-tarefas');
});

// Anti-overfit: quando a PESSOA fala do tópico, o roteador de contexto tem que seguir ganhando.
test('não quebra o caminho normal: tópico na FALA REAL ainda roteia pedagogico', async () => {
  const raw = comQuote('Bom dia! Como posso ajudar?', 'preciso falar com o professor do aluno Eric sobre a turma');
  const skill = await pickSkill(COLLAB, raw, []);
  assert.strictEqual(skill && skill.name, 'pedagogico');
});

test('sem reply-quote nada muda: tópico pedagógico direto continua pedagogico', async () => {
  const skill = await pickSkill(COLLAB, 'o aluno Eric faltou na aula de hoje', []);
  assert.strictEqual(skill && skill.name, 'pedagogico');
});

// O strip só REBAIXA o roteador de tópico, não o desliga: quando a fala real não casa em nada,
// skill errada ainda é melhor que skill nenhuma (sem template de marker o LLM improvisa).
//
// LACUNA FECHADA em 11/09 (ROTEADOR-CITACAO-CONCLUSAO, triagem — bf91c779, 772b4e85): era o turno
// de 12/08 do MESMO caso, deixado aberto de propósito ("ampliar o vocabulário é outra mudança, com
// outro teste vermelho"). A outra mudança veio: resposta com verbo de conclusão a uma mensagem do
// TOM roteia pra checklist-tarefas ANTES do último recurso. A garantia de nunca voltar sem skill
// continua. Texto original abaixo, pro histórico:
// consertado aqui. "concluida" não está no vocabulário de intenção da priority 5 ("fiz|terminei|
// feito|completei|fechei"), então a fala real não casa em nada e o fallback devolve pedagogico —
// mesma rota de antes. O fix desta rodada conserta o turno de 13/08 ("...como feito"), não este.
// Ampliar o vocabulário é outra mudança, com outro teste vermelho.
test('12/08 (lacuna fechada 11/09): conclusão citando a cobrança vai pro checklist-tarefas, NUNCA em skill nenhuma', async () => {
  const raw = comQuote(COBRANCA_CHECKLIST, 'Etapa emusys, dress code concluida');
  const skill = await pickSkill(COLLAB, raw, []);
  assert.ok(skill, 'nunca pode voltar sem skill: sem template de marker o LLM improvisa');
  assert.strictEqual(skill.name, 'checklist-tarefas');
});

// ── ROTEADOR-CITACAO-CONCLUSAO (triagem 11/09 — bf91c779, 772b4e85) ──────────────────────
// A fala REAL de 12/08 13:17 ("Etapa emusys, dress code concluida", citando a cobrança do
// checklist) não casava nada na fala real e caía no último recurso, que lê a CITAÇÃO: o
// "professora" do título citado ligava o pedagógico. Resposta de conclusão a uma mensagem do
// TOM é atualização de tarefa.
test('Quintela 12/08: "Etapa emusys, dress code concluida" citando a cobrança → checklist-tarefas', async () => {
  const skill = await pickSkill(COLLAB, comQuote(COBRANCA_CHECKLIST, 'Etapa emusys, dress code concluida'), []);
  assert.strictEqual(skill && skill.name, 'checklist-tarefas');
});
test('conclusão com acento, "como feito" e ✅ também roteiam; conversa sem conclusão não', async () => {
  for (const fala of ['Cultura concluída', 'pode marcar como feito', 'Dress code ✅', 'Emusys pronto']) {
    const s = await pickSkill(COLLAB, comQuote(COBRANCA_CHECKLIST, fala), []);
    assert.strictEqual(s && s.name, 'checklist-tarefas', fala);
  }
  const outra = await pickSkill(COLLAB, comQuote('Reunião pedagógica com as professoras amanhã', 'e o horário?'), []);
  assert.notStrictEqual(outra && outra.name, 'checklist-tarefas', 'sem verbo de conclusão a regra nova não dispara');
});
