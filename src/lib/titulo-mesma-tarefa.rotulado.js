'use strict';
// Conjunto ROTULADO pra "é a mesma tarefa?" — títulos REAIS (tabela tasks / conversation_history /
// tom-error.log). Montado em 30/09 a partir de:
//  - os 94 pares distintos que o dupguard (IntegrityCheck DUP_TASK) levantou de mai a set/2026,
//    com o título completo recuperado do banco (lado truncado em 40 chars fica como no log);
//  - pares "o que a pessoa escreveu" × "o título que o TOM gravou" (mensagem inbound até 2 min
//    antes do insert, mesma pessoa);
//  - os casos citados no código/auditorias (Norton × Flávio, Revisar × Reajustar).
// Pares ambíguos até pra humano (ex.: "Ir ao Recreio à noite" × "Ir ao Recreio — limpeza de
// esgoto") ficaram FORA de propósito. Pares byte a byte iguais entram só como amostra.
//
// `limite: true` = MESMA tarefa que o método por tokens NÃO tem como ver (sinônimo sem palavra em
// comum: "folha" × "sistema", "Sistema de pagamentos" × "Superfolha"). Fica declarado aqui pra a
// métrica não mentir.

const PARES = [
  // ── MESMA ────────────────────────────────────────────────────────────────────────────────
  { mesma: true, a: 'ver o vídeo da Vitória', b: 'Ver o vídeo de registro de visitas (postado pela Vitória no grupo)' },
  { mesma: true, a: 'Ver o vídeo de registro de visitas que a Vitória postou no grupo', b: 'Ver o vídeo de registro de visitas (postado pela Vitória no grupo)' },
  { mesma: true, a: 'Fazer follow up do L.A Session com Jereh (ver se Alves gravou)', b: 'Follow up L.A Session com Jereh (ver se Alves gravou)' },
  { mesma: true, a: 'Iniciar acesso ao novo sistema RH', b: 'Iniciar acesso ao novo sistema' },
  { mesma: true, a: 'Avisar William sobre treinamentos', b: 'Avisar William sobre inclusão nos treinamentos' },
  { mesma: true, a: 'Inventário das salas — Campo Grande', b: 'Inventário salas — Campo Grande' },
  { mesma: true, a: 'Lembrete: Garage Kids — 18h (Barra World)', b: 'Lembrete: Garage Kids — domingo 18h (Barra World)' },
  { mesma: true, a: 'Visita — Daniel (resp. Billy) — 02/06 18', b: 'Visita — Daniel (resp. Billy)' },
  { mesma: true, a: 'Trocar filtro de linha (20A) — sala do c', b: 'Trocar filtro de linha 20 — Sala do Comercial Recreio' },
  { mesma: true, a: 'Boleto Dona Gema — R$ 507,30', b: 'Pagar boleto Dona Gema' },
  { mesma: true, a: 'Pesquisar livro para entregar quinta e f', b: 'Pesquisar livro para entregar em 04/06 e fazer podcast do último capítulo de A Coragem para Liderar no NotebookLM' },
  { mesma: true, a: 'Editar vídeo Copa do Mundo', b: 'Editar Vídeo Copa do Mundo do Ramon' },
  { mesma: true, a: 'Tom tarefa pra hoje me lembra postar flyer do isac jamba no instagram hoje 17 hrs', b: 'Postar flyer do Isac Jamba no Instagram' },
  { mesma: true, a: 'tom, me lembrar amanhã 09:30 para falar com a Flavia mãe da Beatriz Von', b: 'Falar com a Flavia — mãe da Beatriz Von' },
  { mesma: true, a: 'Me lembra de colocar na planilha de pagamento o valor do Uber do vogue square', b: 'Colocar na planilha de pagamento o valor do Uber do Vogue Square' },
  { mesma: true, a: 'E me lembra também de falar com a krissya sobre a situação do Sérgio', b: 'Falar com a Krissya sobre a situação do Sérgio' },
  { mesma: true, a: 'Me lembra amanhã às 10:30 de falar com a mãe da maria Helena Barbosa', b: 'Falar com a mãe da Maria Helena Barbosa' },
  { mesma: true, a: 'Me lembra amanhã 11h de colocar o sabonete da granado no grupo e na planilha', b: 'Colocar sabonete da Granado no grupo e na planilha' },
  { mesma: true, a: 'Me lembra segunda às 13h de agradecer a Alana', b: 'Agradecer a Alana' },
  { mesma: true, a: 'Marca para amanhã a seguinte tarefa: Ação no Vogue Square 14h', b: 'Ação no Vogue Square' },
  { mesma: true, a: 'Tom me lembra amanhã umas 10h .pegar computador 💻 vlw', b: 'Pegar computador' },
  { mesma: true, a: 'Pegar ponto no AliExpress', b: 'Pegar ponto no AliExpress' },
  { mesma: true, a: 'Conciliação de Cartões', b: 'Conciliação de Cartões' },
  { mesma: true, limite: true, a: 'Liberar a folha para conferência da Dire', b: 'Liberar sistema para conferência da Direção' },
  { mesma: true, limite: true, a: 'Lançar no Sistema de pagamentos', b: 'Lançar no Superfolha' },

  // ── DIFERENTE ────────────────────────────────────────────────────────────────────────────
  { mesma: false, a: 'Follow up com Jereh', b: 'Follow up Eventos Jordan' },
  { mesma: false, a: 'Follow Up Eventos Jordan (Gospel Session e Liverpool Day)', b: 'Follow up L.A Session com Jereh (ver se Alves gravou)' },
  { mesma: false, a: 'Follow up Vocal Kids com Letícia (dia, horário e local)', b: 'Follow up L.A Session com Jereh (ver se Alves gravou)' },
  { mesma: false, a: 'Avaliação de estagiários — Renan', b: 'Avaliação de estagiários — Kinho' },
  { mesma: false, a: 'Avaliação de estagiários — Leo', b: 'Avaliação de estagiários — Kinho' },
  { mesma: false, a: 'Receber e registrar guitarras — Rodrigo', b: 'Receber e registrar violões — Rodrigo' },
  { mesma: false, a: 'Tomar remédio (3ª dose)', b: 'Tomar remédio (2ª dose)' },
  { mesma: false, a: 'Guardar R$500 pro carro — mês 3/40', b: 'Guardar R$500 pro carro — mês 2/40' },
  { mesma: false, a: 'Usar bombinha Asma Alice — noite', b: 'Usar bombinha Asma Alice — manhã' },
  { mesma: false, a: 'Pintar — Sala 5 Canto — Campo Grande', b: 'Pintar sala 6 Canto Kids' },
  { mesma: false, a: 'Pintar sala 6 Canto Kids', b: 'Pintar vaso planta' },
  { mesma: false, a: 'Trocar lâmpada do corredor do estúdio — Campo Grande', b: 'Trocar lâmpada do bistrô — Campo Grande' },
  { mesma: false, a: 'Conversar com a Krissya sobre a sala que o John está dando aula de teatro musical', b: 'Conversar com o John sobre o recital de teatro musical' },
  { mesma: false, a: 'Conversar com a Dai sobre o evento LA Love Songs', b: 'Conversar com a Lohana' },
  { mesma: false, a: 'Conversar com o Isaque sobre os atrasos', b: 'Conversar com a Dai sobre o evento LA Love Songs' },
  { mesma: false, a: 'Conversar com Caio e Kaio sobre atrasos', b: 'Conversar com a Lohana' },
  { mesma: false, a: 'Cancelar aulas do Gabriel Antony', b: 'Cancelar aulas do Isaac e da Mariana' },
  { mesma: false, a: 'Colocar a falta do Willian na planilha', b: 'Colocar o papel A4 na planilha' },
  { mesma: false, a: 'Colocar na planilha o valor do café', b: 'Colocar na planilha de pagamento o valor do Uber do Vogue Square' },
  { mesma: false, a: 'Consertar máquina de lavar', b: 'Consertar caixa de contrabaixo — Estúdio LA Campo Grande' },
  { mesma: false, a: 'Conserto cano (vazamento) — Sala 3 e Sal', b: 'Conserto vaso — banheiro e escritório (Campo Grande)' },
  { mesma: false, a: 'Providenciar jogos lúdicos', b: 'Providenciar rolhas' },
  { mesma: false, a: 'Providenciar prateleira organizadora', b: 'Providenciar caixas organizadoras pequenas' },
  { mesma: false, a: 'Providenciar 50 bolas de aniversário', b: 'Providenciar caixas organizadoras pequenas' },
  { mesma: false, a: 'Separar roupa pro culto', b: 'Separar roupa da escola do Theo' },
  { mesma: false, a: 'Criar grupo de mentoria/técnicos LA Drum', b: 'Criar grupo de coordenação LA Drumagames' },
  { mesma: false, a: 'Preparar fala da mentoria do LA / Emusys', b: 'Preparar módulo do Emusys Academy e colocar no grupo dos mentores' },
  { mesma: false, a: 'Passar demandas de designer para Felipe ', b: 'Passar vídeos dos desafios para o Yuri' },
  { mesma: false, a: 'Avisar Krissya que não vai à escola na sexta (provas da faculdade)', b: 'Avisar Krissya que Arthur vai fechar a escola na terça (02/06)' },
  { mesma: false, a: 'Fazer roteiro do LA Drum Games', b: 'Entregar briefing do vídeo do LA Drum Games ao Jhon e ao Yuri' },
  { mesma: false, a: 'Reunião com equipe de staff do LA Drum G', b: 'Entregar briefing do vídeo do LA Drum Games ao Jhon e ao Yuri' },
  { mesma: false, a: 'Concluir distribuição de alunos nas modalidades do LA Drum Games', b: 'Entregar briefing do vídeo do LA Drum Games ao Jhon e ao Yuri' },
  { mesma: false, a: 'Rider e croqui do LA Drum Games para Raf', b: 'Entregar briefing do vídeo do LA Drum Games ao Jhon e ao Yuri' },
  { mesma: false, a: 'Montar plano de ação do LA Drum Games — ', b: 'Definir local do LA Drum Games' },
  { mesma: false, a: 'Finalizar a estampa da camiseta do staff', b: 'Formatar texto de modalidades do LA Drum Games' },
  { mesma: false, a: 'Confirmar datas do evento de teclas — CG 26/06 | Barra e Recreio 27/06', b: 'Confirmar repertório e ordem de apresentação' },
  { mesma: false, a: 'Confirmar horário de entrada e ensaio co', b: 'Confirmar lista de professores participantes' },
  { mesma: false, a: 'Preparar resumo das anotações e enviar p', b: 'Preparar roteiro técnico do evento' },
  { mesma: false, a: 'Verificar com o Hugo — mensagem automáti', b: 'Verificar com o Hugo pendência do LAReport' },
  { mesma: false, a: 'Lembrete — entrega 30/06', b: 'Lembrete 360' },
  { mesma: false, a: 'Jornada Musicalização — Iniciação a inst', b: 'Jornada Musicalização — Musicalização preparatória' },
  { mesma: false, a: 'Ligar pro Norton', b: 'Ligar pro Flávio' },
  { mesma: false, a: 'Revisar contrato', b: 'Reajustar mentoria' },
];

module.exports = { PARES };
