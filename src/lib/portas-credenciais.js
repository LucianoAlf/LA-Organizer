'use strict';
// portas-credenciais.js — as credenciais de governanca tem DUAS portas independentes, e
// ninguem checa a outra. Modulo PURO: recebe as linhas, devolve o veredito.
//
// AS DUAS PORTAS (medidas em 04/09)
//   TOM (WhatsApp): `collaborators.is_system_admin` — usado pela RPC get_credenciais_para.
//                   Admin recebe as 46 com senha em claro; qualquer outro recebe so nome+link
//                   das marcadas visivel_tom.
//   PWA (Governanca): `role = 'director'` — ProtectedRoute em web/src/App.tsx MAIS as 4
//                   policies de RLS da tabela. Quem passa consulta a TABELA direto, entao ve
//                   as 46 com tudo, sem qualquer filtro de visivel_tom.
//
// Hoje os dois conjuntos coincidem exatamente: Hugo, Luciano e Anne Susan. Mas sao flags
// independentes em lugares diferentes, e a divergencia e SILENCIOSA nos dois sentidos:
//
//   director SEM is_system_admin  → entra na tela de Governanca e le as 46 com senha, mas o
//                                   TOM o trata como time. E o mais grave: a concessao
//                                   acontece ao promover alguem no app, sem ninguem pensar
//                                   em credencial.
//   is_system_admin SEM director  → o TOM entrega tudo por WhatsApp e o app barra. Menos
//                                   provavel, igualmente nao intencional.
//
// Nenhuma das duas portas consulta a outra, entao a unica defesa possivel e VIGIAR: rodar
// isto no health-check das 7h, que ja vai pros diretores.
//
// NAO transformar em sincronizacao automatica: as duas flags significam coisas diferentes
// (uma e papel na empresa, a outra e acesso a segredo) e casar uma na outra concederia
// acesso sozinho — exatamente o que se quer evitar.

/**
 * @param {Array<{full_name?:string, role?:string, is_system_admin?:boolean}>} rows
 *        colaboradores ATIVOS que sao director OU is_system_admin (a consulta ja filtra)
 * @returns {{status:'ok'|'warning', detail:string, samples?:string[]}}
 */
function avaliarPortas(rows) {
  const lista = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const nome = (r) => String(r.full_name || '(sem nome)').trim() || '(sem nome)';

  const soPwa = lista.filter(r => r.role === 'director' && r.is_system_admin !== true);
  const soTom = lista.filter(r => r.is_system_admin === true && r.role !== 'director');
  const ambos = lista.filter(r => r.role === 'director' && r.is_system_admin === true);

  if (!soPwa.length && !soTom.length) {
    return {
      status: 'ok',
      detail: `Portas de credencial alinhadas: ${ambos.length} pessoa(s) com acesso total `
        + `(${ambos.map(nome).join(', ') || '—'}).`,
    };
  }

  const samples = [
    ...soPwa.map(r => `${nome(r)}: director no app (vê as senhas na Governança) mas NÃO é is_system_admin — o TOM o trata como time`),
    ...soTom.map(r => `${nome(r)}: is_system_admin (o TOM entrega tudo no WhatsApp) mas NÃO é director — o app barra`),
  ];

  return {
    status: 'warning',
    detail: `Portas de credencial divergem em ${soPwa.length + soTom.length} pessoa(s). `
      + `As duas flags são independentes: promover alguém a director concede leitura das `
      + `senhas na Governança sem tocar em is_system_admin.`,
    samples,
  };
}

module.exports = { avaliarPortas };
