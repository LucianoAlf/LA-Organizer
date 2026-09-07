'use strict';
// sonda-roteador2.js — SOMENTE LEITURA. Versao corrigida.
//
// A v1 dava 68,4% de "erro de rota" e estava ERRADA por duas razoes:
//   (a) o PROMPT BASE (system.js) ja documenta 42 marcadores. "Sem skill" nao e "sem saber":
//       o modelo tem o CONTRATO; o que falta e a orientacao de DOMINIO.
//   (b) REACT e VOICE_SENT sao gravados pelo MOTOR (logMarker no engine), nao emitidos pelo
//       modelo. Contar isso como erro de rota e medir o instrumento, nao a casa.
//
// Criterio corrigido, em tres niveis:
//   SEM_DOC   — o marcador nao esta nem na skill carregada nem no prompt base. O modelo
//               emitiu algo que ninguem ensinou naquele turno. Isso e falha de rota de verdade.
//   SO_BASE   — o modelo tinha o contrato generico, mas NAO a skill que fala daquele marcador.
//               Nao e cegueira: e acao sem orientacao de dominio.
//   COM_SKILL — a skill carregada documenta o marcador emitido. Rota util.
//
// "Marcador do modelo" e derivado, nao chutado: e o que aparece como <<NOME>> em algum texto
// de prompt (system.js ou skills/). O que nunca aparece, o modelo nunca foi ensinado a emitir.

const fs = require('fs');
const path = require('path');
const RAIZ = '/opt/LA-Organizer';
const supabase = require(path.join(RAIZ, 'src/supabase/client'));
const { pickSkill } = require(path.join(RAIZ, 'src/prompts/system'));

const DIR_SKILLS = path.join(RAIZ, 'skills');
const JANELA_DIAS = Number(process.env.SONDA_DIAS || 30);
const TETO = Number(process.env.SONDA_TETO || 800);

const marcadoresDe = (txt) => new Set((txt.match(/<<([A-Z_]+)>>/g) || []).map((m) => m.replace(/[<>]/g, '')));

const BASE = marcadoresDe(fs.readFileSync(path.join(RAIZ, 'src/prompts/system.js'), 'utf8'));
BASE.delete('END');

const docsPorSkill = {};
const ENSINADOS = new Set(BASE);
for (const f of fs.readdirSync(DIR_SKILLS).filter((x) => /\.md$/.test(x))) {
  const nome = f.replace(/\.md$/, '');
  const set = marcadoresDe(fs.readFileSync(path.join(DIR_SKILLS, f), 'utf8'));
  set.delete('END');
  docsPorSkill[nome] = set;
  for (const m of set) ENSINADOS.add(m);
}

// TRANSVERSAIS: comportamento que vale em QUALQUER conversa (reagir com emoji). Sao
// ensinados numa skill, mas cobrar a rota por eles mede o instrumento, nao a casa.
for (const t of ["REACT"]) ENSINADOS.delete(t);

async function main() {
  const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString();
  const { data: msgs, error } = await supabase.from('conversation_history')
    .select('id, collaborator_id, content, created_at')
    .eq('direction', 'inbound').gte('created_at', desde)
    .order('created_at', { ascending: false }).limit(TETO);
  if (error) throw new Error(error.message);

  const { data: mks } = await supabase.from('marker_logs')
    .select('collaborator_id, marker_type, created_at').gte('created_at', desde).limit(20000);
  const marcadores = mks || [];

  const c = { total: 0, semSkill: 0, semAcao: 0, avaliaveis: 0, comSkill: 0, soBase: 0, semDoc: 0 };
  const porSkill = {};
  const soBaseDet = {};
  const semDocDet = {};
  const naoEnsinados = {};

  for (const m of msgs) {
    c.total++;
    let skill = null;
    try {
      const r = await pickSkill({ id: m.collaborator_id, onboarding_completed: true }, m.content, []);
      skill = r && r.name ? r.name : null;
    } catch (_) { skill = '__erro__'; }
    porSkill[skill || '(nenhuma)'] = (porSkill[skill || '(nenhuma)'] || 0) + 1;
    if (!skill) c.semSkill++;

    const t0 = new Date(m.created_at).getTime();
    const tipos = [...new Set(marcadores
      .filter((k) => k.collaborator_id === m.collaborator_id)
      .filter((k) => { const d = new Date(k.created_at).getTime() - t0; return d >= 0 && d <= 90000; })
      .map((k) => k.marker_type))];

    // Fora do criterio: o que o modelo NUNCA foi ensinado a emitir (logs do motor).
    for (const t of tipos) if (!ENSINADOS.has(t)) naoEnsinados[t] = (naoEnsinados[t] || 0) + 1;
    const doModelo = tipos.filter((t) => ENSINADOS.has(t));
    if (!doModelo.length) { c.semAcao++; continue; }
    c.avaliaveis++;

    // CORRECAO (07/09): "max 1" nao e literal. Alem da primaria, o prompt carrega
    // auxiliares SEMPRE: integridade-agenda, criar-compromisso e pedagogico (as duas
    // ultimas so nao duplicam quando ja sao a primaria); priorizacao-inteligente entra
    // para 3 primarias. Medir so a primaria subestima a cobertura.
    const AUX = ["integridade-agenda", "criar-compromisso", "pedagogico"];
    const AUX_PRIO = ["checklist-tarefas", "criar-compromisso", "cadastro-projeto-5w2h"];
    const carregadas = [skill].filter(Boolean).concat(AUX.filter((a) => a !== skill));
    if (skill && AUX_PRIO.includes(skill)) carregadas.push("priorizacao-inteligente");
    const doc = new Set();
    for (const nome of carregadas) for (const t of (docsPorSkill[nome] || [])) doc.add(t);
    const semDoc = doModelo.filter((t) => !doc.has(t) && !BASE.has(t));
    const soBase = doModelo.filter((t) => !doc.has(t) && BASE.has(t));

    if (semDoc.length) {
      c.semDoc++;
      const k = (skill || '(nenhuma)') + '  ->  ' + semDoc.join(',');
      semDocDet[k] = (semDocDet[k] || 0) + 1;
    } else if (soBase.length) {
      c.soBase++;
      const k = (skill || '(nenhuma)') + '  ->  ' + soBase.join(',');
      soBaseDet[k] = (soBaseDet[k] || 0) + 1;
    } else c.comSkill++;
  }

  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');
  console.log('SONDA DO ROTEADOR v2 — somente leitura · ' + JANELA_DIAS + 'd · ' + c.total + ' falas reais');
  console.log('marcadores que o modelo E ENSINADO a emitir: ' + ENSINADOS.size + '  (base: ' + BASE.size + ')');
  console.log('');
  console.log('  turnos SEM skill carregada ....... ' + c.semSkill + '  (' + pct(c.semSkill, c.total) + ')');
  console.log('  turnos sem acao do modelo ........ ' + c.semAcao + '  (' + pct(c.semAcao, c.total) + ')');
  console.log('  turnos avaliaveis (com acao) ..... ' + c.avaliaveis);
  console.log('    a skill carregada cobria ....... ' + c.comSkill + '  (' + pct(c.comSkill, c.avaliaveis) + ')');
  console.log('    so o prompt BASE cobria ........ ' + c.soBase + '  (' + pct(c.soBase, c.avaliaveis) + ')  <- agiu sem orientacao de dominio');
  console.log('    NINGUEM documentava ............ ' + c.semDoc + '  (' + pct(c.semDoc, c.avaliaveis) + ')  <- falha de rota de verdade');
  console.log('');
  console.log('--- rotas mais escolhidas ---');
  for (const [k, v] of Object.entries(porSkill).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log('  ' + String(v).padStart(4) + '  ' + k);
  console.log('');
  console.log('--- agiu so com o contrato base (top 10) ---');
  for (const [k, v] of Object.entries(soBaseDet).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log('  ' + String(v).padStart(4) + '  ' + k);
  console.log('');
  console.log('--- ninguem documentava (top 8) ---');
  for (const [k, v] of Object.entries(semDocDet).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log('  ' + String(v).padStart(4) + '  ' + k);
  console.log('');
  console.log('--- fora do criterio: registros do MOTOR, nao do modelo ---');
  for (const [k, v] of Object.entries(naoEnsinados).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log('  ' + String(v).padStart(4) + '  ' + k);
}

main().catch((e) => { console.error('SONDA FALHOU:', e.message); process.exit(1); });
