// web/src/screens/grupos/PixPainel.tsx — painel "PIX automático" no workspace do grupo (Alf, 28/09).
// Pedido do Arthur (Barra): ver os nomes de quem já foi e de quem falta, com filtro, busca e um
// relógio até a meta. Os números e as seções vêm do TOM — as MESMAS da mensagem do grupo e do
// relatório de segunda. Grupo sem unidade (ex.: grupos que não são de uma unidade) não mostra nada.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { usePixPainel } from '../../hooks/usePixPainel';
import { contagemRegressiva, filtrarSecoes, porcentagem, type PixPainel as Painel } from '../../lib/pixPainel';
import { Tabs } from '../../components/Tabs';
import { ChipFilterRow } from '../../components/ChipFilterRow';

const CHAVE_ABERTO = 'pix-painel-aberto';
const lerAberto = () => { try { return localStorage.getItem(CHAVE_ABERTO) === '1'; } catch { return false; } };
const gravarAberto = (v: boolean) => { try { localStorage.setItem(CHAVE_ABERTO, v ? '1' : '0'); } catch { /* sem storage: só não lembra */ } };

const brDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const brHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dois = (n: number) => String(n).padStart(2, '0');

function Relogio({ metaYmd }: { metaYmd: string }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const c = contagemRegressiva(metaYmd, agora);
  if (c.vencida) {
    return (
      <div>
        <div className="text-label uppercase tracking-wide text-danger">⏰ Meta</div>
        <div className="text-card-title font-semibold text-danger">Venceu em {brDia(metaYmd)}</div>
      </div>
    );
  }
  const unidades: [number | string, string][] = [[c.dias, c.dias === 1 ? 'dia' : 'dias'], [dois(c.horas), 'h'], [dois(c.minutos), 'min'], [dois(c.segundos), 's']];
  return (
    <div>
      <div className="text-label uppercase tracking-wide text-fg-muted">⏰ Até a meta · {brDia(metaYmd)}</div>
      <div className="flex items-end gap-sm mt-xs" aria-label={`Faltam ${c.dias} dias, ${c.horas} horas e ${c.minutos} minutos pra meta`}>
        {unidades.map(([v, rot]) => (
          <div key={rot} className="flex flex-col items-center min-w-[2.75rem] rounded-md bg-bg-subtle border border-border px-xs py-xs">
            <span className="text-card-title font-bold tabular-nums text-fg leading-none">{v}</span>
            <span className="text-[11px] text-fg-muted mt-0.5">{rot}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Resumo({ p }: { p: Painel }) {
  const pct = porcentagem(p.migrados, p.total);
  return (
    <div className="grid gap-md md:grid-cols-[1.2fr_1fr] items-center">
      <div>
        <div className="text-label uppercase tracking-wide text-fg-muted">✅ Já migraram</div>
        <div className="flex items-baseline gap-xs mt-xs">
          <span className="text-screen-title font-bold tabular-nums text-fg">{p.migrados}</span>
          <span className="text-body-md text-fg-muted">de {p.total} · {pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-bg-subtle border border-border mt-sm overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-tom rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-md gap-y-xs mt-sm text-body-sm text-fg-muted">
          <span>⏳ Faltam <b className="text-fg">{p.faltam}</b></span>
          {p.cadastradosSemCobranca > 0 && <span>🔵 {p.cadastradosSemCobranca} sem cobrança</span>}
          {(p.cartaoCadastrado ?? 0) > 0 && <span>💳 {p.cartaoCadastrado} conferir no Emusys</span>}
          {p.aguardandoEmusys > 0 && <span>🔒 {p.aguardandoEmusys} aguardando o Emusys</span>}
        </div>
      </div>
      <Relogio metaYmd={p.metaYmd} />
    </div>
  );
}

function Lista({ p }: { p: Painel }) {
  const [aba, setAba] = useState<'faltam' | 'ja'>('faltam');
  const [secao, setSecao] = useState('todas');
  const [busca, setBusca] = useState('');
  const secoes = useMemo(() => filtrarSecoes(p.faltamSecoes, secao, busca), [p.faltamSecoes, secao, busca]);
  const ja = useMemo(() => filtrarSecoes([{ chave: 'ja', emoji: '✅', nome: 'Já no PIX automático', nota: null, n: p.jaMigraram.length, clientes: p.jaMigraram }], 'todas', busca), [p.jaMigraram, busca]);
  const mostradas = aba === 'faltam' ? secoes : ja;
  const vazio = mostradas.every((s) => s.clientes.length === 0);

  return (
    <div className="mt-md space-y-sm">
      <div className="flex flex-wrap items-center gap-sm">
        <Tabs
          tabs={[{ id: 'faltam', label: 'Faltam', badge: p.faltam }, { id: 'ja', label: 'Já migraram', badge: p.migrados }]}
          active={aba}
          onChange={setAba}
        />
        <label className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar responsável ou aluno"
            aria-label="Buscar responsável ou aluno"
            className="h-8 w-full rounded-md border border-border bg-bg-surface pl-8 pr-2 text-body-sm text-fg placeholder:text-fg-muted focus-ring"
          />
        </label>
      </div>

      {aba === 'faltam' && (
        <ChipFilterRow
          items={[{ id: 'todas', label: 'Todas', count: p.faltam }, ...p.faltamSecoes.map((s) => ({ id: s.chave, label: `${s.emoji} ${s.nome}`, count: s.n }))]}
          activeId={secao}
          onChange={setSecao}
        />
      )}

      {vazio && <p className="text-body-sm text-fg-muted py-sm">{busca ? `Ninguém com "${busca}" nesta lista.` : 'Ninguém nesta lista agora.'}</p>}

      {mostradas.map((s) => (
        <section key={s.chave}>
          <div className="flex flex-wrap items-baseline gap-x-sm mb-xs">
            <h4 className="text-body-md font-semibold text-fg">{s.emoji} {s.nome} <span className="text-fg-muted font-normal tabular-nums">({s.clientes.length})</span></h4>
            {s.nota && <span className="text-body-sm text-fg-muted">{s.nota}</span>}
          </div>
          <ul className="rounded-md border border-border divide-y divide-border bg-bg-surface">
            {s.clientes.map((c, i) => (
              <li key={`${c.nome}-${i}`} className="px-md py-sm">
                <div className="text-body-md text-fg">{c.nome}</div>
                {c.alunos.length > 0 && <div className="text-body-sm text-fg-muted">{c.alunos.join(' · ')}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function PixPainel({ groupId }: { groupId: string }) {
  const q = usePixPainel(groupId);
  const [aberto, setAberto] = useState(lerAberto);
  const alternar = () => setAberto((v) => { gravarAberto(!v); return !v; });

  if (q.isLoading) return <div className="h-28 rounded-md border border-border bg-bg-surface animate-pulse" aria-label="Carregando o painel do PIX automático" />;
  const r = q.data;
  if (!r || r.tipo === 'sem_unidade') return null;
  if (r.tipo === 'erro') {
    return (
      <div className="rounded-md border border-border bg-bg-surface p-md text-body-sm text-fg-muted">
        💠 PIX automático — não consegui ler a fonte agora. Tento de novo em alguns minutos.
      </div>
    );
  }
  const p = r.painel;
  return (
    <section className="rounded-md border border-tom/40 bg-bg-surface shadow-card dark:shadow-none p-md" aria-label="PIX automático">
      <div className="flex items-center gap-sm mb-md">
        <h3 className="text-body-lg font-semibold text-fg">💠 PIX automático{p.unidade ? ` · ${p.unidade}` : ''}</h3>
        {p.dadoEm && <span className="text-body-sm text-fg-muted max-md:hidden">atualizado {brHora(p.dadoEm)}</span>}
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="ml-auto inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-body-sm font-semibold text-fg hover:bg-bg-elevated focus-ring"
        >
          {aberto ? <>Esconder nomes <ChevronUp size={14} /></> : <>Ver nomes <ChevronDown size={14} /></>}
        </button>
      </div>
      <Resumo p={p} />
      {aberto && <Lista p={p} />}
    </section>
  );
}
