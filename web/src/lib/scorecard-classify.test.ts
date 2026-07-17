import { describe, it, expect } from 'vitest';
import {
  classifyScorecard, pctOf, byRateNoScoreLast, byClosedThenName, byNameThenId,
  type ScoreLite, type ScoreSortable, type ScoreSortableClosed,
} from './scorecard-classify';

const S = (p: Partial<ScoreLite>): ScoreLite => ({ closure_rate: 1, tasks_closed: 0, tasks_overdue: 0, tasks_stuck: 0, ...p });

describe('classifyScorecard (port scorecard-builder.js:202-209)', () => {
  it('🔴 atenção: closure < 0.60', () => {
    expect(classifyScorecard(S({ closure_rate: 0.29, tasks_closed: 2, tasks_overdue: 5 }))).toBe('atencao');
  });
  it('🔴 atenção: 3+ atrasadas mesmo com closure alto', () => {
    expect(classifyScorecard(S({ closure_rate: 0.9, tasks_closed: 9, tasks_overdue: 3 }))).toBe('atencao');
  });
  it('🔴 atenção: 2+ travadas', () => {
    expect(classifyScorecard(S({ closure_rate: 0.86, tasks_closed: 6, tasks_stuck: 2 }))).toBe('atencao');
  });
  it('🟡 olhar: closure 0.80 + 1 atrasada (não bate vermelho)', () => {
    expect(classifyScorecard(S({ closure_rate: 0.80, tasks_closed: 4, tasks_overdue: 1 }))).toBe('olhar');
  });
  it('🟡 olhar: 1 atrasada com closure alto', () => {
    expect(classifyScorecard(S({ closure_rate: 0.95, tasks_closed: 10, tasks_overdue: 1 }))).toBe('olhar');
  });
  it('🟢 ritmo: sem tarefas', () => {
    expect(classifyScorecard(S({}))).toBe('ritmo');
  });
  it('🟢 ritmo: 100% sem atraso', () => {
    expect(classifyScorecard(S({ closure_rate: 1, tasks_closed: 8 }))).toBe('ritmo');
  });
});

// Paridade com src/rituals/leader-cards.js → classifyCard. Os dois mudam juntos.
it('guard de null: sem nota e sem pendência → ritmo, NUNCA atencao', () => {
  expect(classifyScorecard({
    closure_rate: null, tasks_closed: 0, tasks_overdue: 0, tasks_stuck: 0,
  })).toBe('ritmo');
});

it('guard de null: sem nota mas com pendência → olhar (não atencao por null < 0.60)', () => {
  expect(classifyScorecard({
    closure_rate: null, tasks_closed: 0, tasks_overdue: 2, tasks_stuck: 0,
  })).toBe('olhar');
});

it('líder afogado nas próprias com time limpo → atencao', () => {
  expect(classifyScorecard({
    closure_rate: 0.2, tasks_closed: 2, tasks_overdue: 8, tasks_stuck: 0,
  })).toBe('atencao');
});

// ── pctOf ──────────────────────────────────────────────────────────────────────
// Regressão da unidade que os 3 consumidores de % usam. NÃO cobre o JSX de nenhum
// componente (ver relatório da Task 8): mede só a régua do "sem nota não vira 0%".
describe('pctOf', () => {
  it('sem nota → null, NUNCA 0 (0% é o oposto de "sem nota")', () => {
    expect(pctOf(null)).toBeNull();
  });
  it('0 real → 0 — nota real passa (guard é === null, nunca ?? / ||)', () => {
    expect(pctOf(0)).toBe(0);
  });
  it('arredonda pra inteiro', () => {
    expect(pctOf(0.856)).toBe(86);
  });
  it('1 → 100', () => {
    expect(pctOf(1)).toBe(100);
  });
});

// ── byRateNoScoreLast ──────────────────────────────────────────────────────────
// PORT de src/services/scorecard-render.js → byRateNoScoreLast. Os dois mudam juntos.
const R = (leader_id: string, closure_rate: number | null, full_name = leader_id): ScoreSortable =>
  ({ leader_id, closure_rate, leader: { full_name, preferred_name: null } });

describe('byRateNoScoreLast (port scorecard-render.js:46-53)', () => {
  it('sem nota vai DEPOIS de 0% real — são opostos, não empate; nenhum dos dois some', () => {
    const semNota = R('a', null, 'Ana');
    const zeroReal = R('b', 0, 'Bruno');
    expect([semNota, zeroReal].sort(byRateNoScoreLast).map(r => r.leader_id)).toEqual(['b', 'a']);
    // Mesma saída com a entrada invertida — a ordem de entrada não pode decidir nada.
    expect([zeroReal, semNota].sort(byRateNoScoreLast).map(r => r.leader_id)).toEqual(['b', 'a']);
  });

  it('ambos com nota: pior primeiro (régua de hoje preservada)', () => {
    expect([R('a', 0.9, 'Ana'), R('b', 0.2, 'Bruno')].sort(byRateNoScoreLast).map(r => r.leader_id))
      .toEqual(['b', 'a']);
  });

  it('dois sem-nota: comparator VÁLIDO — nunca NaN (nada de Infinity como sentinela)', () => {
    const r = byRateNoScoreLast(R('a', null, 'Ana'), R('b', null, 'Bruno'));
    expect(Number.isNaN(r)).toBe(false);
    expect(r).toBeLessThan(0);   // desempata por nome, não fica indefinido
  });

  it('determinismo: mesma entrada em 2 ordens → mesma saída (tiebreak fecha o empate novo)', () => {
    const rows = [R('a', null, 'Ana'), R('b', null, 'Bruno'), R('c', 0.3, 'Carla'), R('d', 0.3, 'Dani')];
    const um = [...rows].sort(byRateNoScoreLast).map(r => r.leader_id);
    const dois = [...rows].reverse().sort(byRateNoScoreLast).map(r => r.leader_id);
    expect(um).toEqual(dois);
    expect(um).toEqual(['c', 'd', 'a', 'b']);   // com nota (pior→melhor), depois sem nota (nome)
  });

  it('leader null (join sem match) não quebra o tiebreak — cai no leader_id', () => {
    const a: ScoreSortable = { leader_id: 'zzz', closure_rate: null, leader: null };
    const b: ScoreSortable = { leader_id: 'aaa', closure_rate: null, leader: null };
    expect([a, b].sort(byRateNoScoreLast).map(r => r.leader_id)).toEqual(['aaa', 'zzz']);
  });
});

// ── byClosedThenName ───────────────────────────────────────────────────────────
// PORT de src/services/scorecard-render.js:91 (o sort do balde `ritmo`). Os dois mudam
// juntos. `ritmo` imprime os nomes em LINHA colapsada — é o balde onde o reembaralho do
// heap do Postgres é MAIS visível, por isso o tiebreak não é opcional.
const C = (leader_id: string, tasks_closed: number, full_name = leader_id): ScoreSortableClosed =>
  ({ leader_id, tasks_closed, closure_rate: 1, leader: { full_name, preferred_name: null } });

describe('byClosedThenName (port scorecard-render.js:91)', () => {
  it('quem fechou MAIS vem primeiro', () => {
    expect([C('a', 2, 'Ana'), C('b', 9, 'Bruno')].sort(byClosedThenName).map(r => r.leader_id))
      .toEqual(['b', 'a']);
  });

  it('determinismo: mesma entrada em 2 ordens → mesma saída (tiebreak fecha o empate)', () => {
    // Empate em tasks_closed é o caso COMUM neste balde (vários líderes estáveis).
    const rows = [C('a', 3, 'Ana'), C('b', 3, 'Bruno'), C('c', 3, 'Carla')];
    const um = [...rows].sort(byClosedThenName).map(r => r.leader_id);
    const dois = [...rows].reverse().sort(byClosedThenName).map(r => r.leader_id);
    expect(um).toEqual(dois);
    expect(um).toEqual(['a', 'b', 'c']);
  });

  it('mais fechadas ganha do nome — a ordem não é alfabética, é por volume', () => {
    const rows = [C('a', 1, 'Ana'), C('z', 7, 'Zeca')];
    expect([...rows].sort(byClosedThenName).map(r => r.leader_id)).toEqual(['z', 'a']);
  });

  it('empate em tasks_closed com leader null cai no leader_id', () => {
    const a: ScoreSortableClosed = { leader_id: 'zzz', tasks_closed: 5, closure_rate: null, leader: null };
    const b: ScoreSortableClosed = { leader_id: 'aaa', tasks_closed: 5, closure_rate: null, leader: null };
    expect([a, b].sort(byClosedThenName).map(r => r.leader_id)).toEqual(['aaa', 'zzz']);
  });
});

// ── byNameThenId ───────────────────────────────────────────────────────────────
// Público a partir do FIX 3: é o tiebreak COMPARTILHADO pelos dois comparadores acima.
// Um segundo tiebreak escrito à mão divergiria — este é o único.
describe('byNameThenId', () => {
  it('ordena por nome com locale pt-BR (acento não vai pro fim)', () => {
    const rows = [
      { leader_id: '2', closure_rate: null, leader: { full_name: 'Ana', preferred_name: null } },
      { leader_id: '1', closure_rate: null, leader: { full_name: 'Ágata', preferred_name: null } },
    ];
    expect([...rows].sort(byNameThenId).map(r => r.leader_id)).toEqual(['1', '2']);
  });

  it('mesmo nome → desempata por leader_id (nunca ordem de entrada)', () => {
    const rows = [
      { leader_id: 'b', closure_rate: null, leader: { full_name: 'Ana', preferred_name: null } },
      { leader_id: 'a', closure_rate: null, leader: { full_name: 'Ana', preferred_name: null } },
    ];
    expect([...rows].sort(byNameThenId).map(r => r.leader_id)).toEqual(['a', 'b']);
  });
});
