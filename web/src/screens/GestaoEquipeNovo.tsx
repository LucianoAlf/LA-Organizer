import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../components/Toast';
import type { Role } from '../types';
import { useQuery } from '@tanstack/react-query';
import { ROLES, ROLE_RANK, ROLE_LABELS, JOB_TITLES, FUNCTION_ROLE_OPTIONS } from '../lib/roles';
import { resolveLeadersOf, groupLeaderIdsFor, type Collab } from '../lib/team-routing';
import { fetchGroupLeaders, addGovernanceEdge } from '../lib/governance-edges';
const UNIT_OPTIONS = [
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
  { value: 'all',          label: 'Geral' },
] as const;

export function GestaoEquipeNovo() {
  const { role: myRole } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [fullName,      setFullName]      = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [functionTitle, setFunctionTitle] = useState('');
  const [selectedRole,  setSelectedRole]  = useState<Role>('collaborator');
  const [selectedUnit,  setSelectedUnit]  = useState('');
  const [functionRole,  setFunctionRole]  = useState('');
  const [selectedLeaders, setSelectedLeaders] = useState<string[]>([]);
  const isDirector = myRole === 'director';

  const { data: roster = [] } = useQuery({
    queryKey: ['gov-roster'],
    queryFn: async () => {
      const { data } = await supabase.from('collaborators')
        .select('id, full_name, preferred_name, role, function_role, unit, supervisor_id, is_ceo, is_active')
        .eq('is_active', true);
      return (data ?? []) as Array<Collab & { full_name: string; preferred_name: string | null }>;
    },
    enabled: isDirector,
  });
  const { data: groupLeaders = [] } = useQuery({
    queryKey: ['gov-leaders'],
    queryFn: fetchGroupLeaders,
    enabled: isDirector,
  });

  // Admins só podem criar roles até o seu próprio nível
  const myRank = ROLE_RANK[(myRole as Role) ?? 'collaborator'] ?? 0;
  const allowedRoles = ROLES.filter(r => ROLE_RANK[r] <= myRank);

  function handleRoleChange(r: Role) {
    setSelectedRole(r); // cargo é INDEPENDENTE do nível de acesso — não reseta mais
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !phone.trim() || !email.trim()) {
      showToast({ kind: 'error', title: 'Preencha nome, WhatsApp e e-mail.' });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-collaborator', {
        body: {
          full_name:      fullName.trim(),
          phone:          phone.replace(/\D/g, ''),
          email:          email.trim().toLowerCase(),
          function_title: functionTitle.trim() || null,
          role:           selectedRole,
          unit:           selectedUnit || null,
        },
      });
      if (error || !data?.ok) {
        const msg =
          data?.error === 'email_already_exists' ? 'Esse e-mail já está cadastrado.'
          : data?.error === 'role_not_allowed'   ? 'Você não tem permissão para criar esse cargo.'
          : data?.error === 'invalid_phone'      ? 'WhatsApp inválido — use só dígitos com DDD.'
          : data?.error === 'missing_required_fields' ? 'Preencha todos os campos obrigatórios.'
          : 'Erro ao criar colaborador. Tente novamente.';
        showToast({ kind: 'error', title: msg });
        return;
      }
      // Governança (só Diretor): grava grupo + arestas no novo colaborador (id volta no response).
      const newId = data.collaborator_id as string | undefined;
      if (isDirector && newId) {
        try {
          if (functionRole) await supabase.from('collaborators').update({ function_role: functionRole }).eq('id', newId);
          for (const leaderId of selectedLeaders) await addGovernanceEdge(newId, leaderId);
        } catch {
          showToast({ kind: 'error', title: 'Criado, mas falhou ao salvar a governança — ajuste na edição.' });
        }
      }
      const extra = data.whatsapp_sent ? '' : ' (link WhatsApp não enviado — verifique o número)';
      showToast({ kind: 'success', title: `Colaborador criado!${extra}` });
      navigate('/mais/gestao-equipe');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none';
  const chipCls  = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-body-sm font-medium border transition-colors ${
      active ? 'bg-tom text-black border-tom' : 'bg-bg-elevated border-border text-fg'
    }`;

  const draftMe: Collab = {
    id: '__new__', role: selectedRole, function_role: functionRole || null, unit: selectedUnit || null,
    supervisor_id: null, is_ceo: false, is_active: true,
    explicit_leader_ids: selectedLeaders,
    group_leader_ids: groupLeaderIdsFor(
      { id: '__new__', role: selectedRole, function_role: functionRole || null, unit: selectedUnit || null, supervisor_id: null, is_ceo: false } as Collab,
      groupLeaders,
    ),
  };
  const draftAll: Collab[] = [...roster, draftMe];
  const nameOf = (cid: string) => {
    const c = roster.find(x => x.id === cid);
    return c?.preferred_name || c?.full_name || cid;
  };
  const previewLeaders = resolveLeadersOf(draftMe, draftAll).filter(c => c.id !== '__new__').map(c => nameOf(c.id));
  const unitLabelOf = (u: string) => UNIT_OPTIONS.find(x => x.value === u)?.label || u;
  const leadersOfGroup = (fr: string) => groupLeaders.filter(g => g.group_key === fr).map(g => {
    const c = roster.find(x => x.id === g.leader_id);
    const nm = c?.preferred_name || c?.full_name || '?';
    return g.unit === 'all' ? nm : `${nm} (${unitLabelOf(g.unit)})`;
  });
  function toggleLeader(idv: string) {
    setSelectedLeaders(prev => prev.includes(idv) ? prev.filter(x => x !== idv) : [...prev, idv]);
  }

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Novo colaborador" backTo="/mais/gestao-equipe" />

      <form onSubmit={handleSubmit} className="space-y-lg">
        {/* Dados pessoais */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Dados pessoais</h2>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Nome completo *</label>
            <input type="text" required value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ex: Maria Silva"
              className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">WhatsApp * (só dígitos com DDD)</label>
            <input type="tel" inputMode="numeric" required value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="5521999999999"
              className={`${inputCls} tabular-nums`} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">E-mail *</label>
            <input type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="maria@lamusic.com.br"
              className={inputCls} />
          </div>
        </section>

        {/* Função */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Função</h2>
          <div className="space-y-md">
            <label className="text-body-sm text-fg-muted">Cargo (opcional)</label>
            <div className="flex flex-wrap gap-2">
              {JOB_TITLES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFunctionTitle(functionTitle === t ? '' : t)}
                  className={chipCls(functionTitle === t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Acesso */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Nível de acesso</h2>
          <div className="flex flex-wrap gap-2">
            {allowedRoles.map(r => (
              <button key={r} type="button" onClick={() => handleRoleChange(r)}
                className={chipCls(selectedRole === r)}>
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </section>

        {/* Unidade */}
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Unidade (opcional)</h2>
          <div className="flex flex-wrap gap-2">
            {UNIT_OPTIONS.map(u => (
              <button key={u.value} type="button"
                onClick={() => setSelectedUnit(selectedUnit === u.value ? '' : u.value)}
                className={chipCls(selectedUnit === u.value)}>
                {u.label}
              </button>
            ))}
          </div>
        </section>

        {/* Governança (só Diretor) — já cria subordinado */}
        {isDirector && (
          <section className="surface p-lg space-y-md">
            <h2 className="text-label text-fg-muted uppercase tracking-wide">Governança</h2>

            <div className="space-y-md">
              <label className="text-body-sm text-fg-muted">Grupo de governança</label>
              <p className="text-body-sm text-fg-muted">
                Quem for Gerente/Coordenador do mesmo grupo vira líder automático — já cria subordinado.
              </p>
              <div className="flex flex-wrap gap-2">
                {FUNCTION_ROLE_OPTIONS.map(f => (
                  <button key={f.value} type="button"
                    onClick={() => setFunctionRole(functionRole === f.value ? '' : f.value)}
                    className={chipCls(functionRole === f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="rounded-lg bg-bg-elevated border border-border p-3 text-body-sm space-y-0.5">
                {FUNCTION_ROLE_OPTIONS.map(f => {
                  const ls = leadersOfGroup(f.value);
                  return (
                    <div key={f.value}>
                      <span className="text-fg-muted">{f.label} → </span>
                      {ls.length
                        ? <span className="text-fg">{ls.join(', ')}</span>
                        : <span className="text-fg-muted italic">sem líder ainda</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-md">
              <label className="text-body-sm text-fg-muted">Reporta a (líderes explícitos — soma às regras)</label>
              <p className="text-body-sm text-fg-muted">Toque pra marcar; toque de novo (no chip verde com ✕) pra remover.</p>
              <div className="flex flex-wrap gap-2">
                {roster.filter(c => !c.is_ceo).map(c => {
                  const active = selectedLeaders.includes(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => toggleLeader(c.id)}
                      className={chipCls(active)}>
                      {c.preferred_name || c.full_name}{active ? ' ✕' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg bg-bg-elevated border border-border p-3 text-body-sm">
              <span className="text-fg-muted">Vai reportar a: </span>
              <span className="text-fg">{previewLeaders.length ? previewLeaders.join(', ') : '—'}</span>
            </div>
          </section>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-tom text-black font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {saving ? 'Criando...' : 'Criar e enviar link WhatsApp →'}
        </button>
      </form>
    </div>
  );
}
