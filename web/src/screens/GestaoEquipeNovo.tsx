import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../components/Toast';
import type { Role } from '../types';
import { ROLES, ROLE_RANK, ROLE_LABELS, ALL_FUNCTION_TITLES } from '../lib/roles';
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
      active ? 'bg-tom text-white border-tom' : 'bg-bg-elevated border-border text-fg'
    }`;

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
              {ALL_FUNCTION_TITLES.map(t => (
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

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-tom text-white font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {saving ? 'Criando...' : 'Criar e enviar link WhatsApp →'}
        </button>
      </form>
    </div>
  );
}
