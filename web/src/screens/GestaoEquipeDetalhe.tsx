import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { showToast } from '../components/Toast';
import type { Role } from '../types';
import { ROLES, ROLE_RANK, ROLE_LABELS, JOB_TITLES } from '../lib/roles';
const UNIT_OPTIONS = [
  { value: 'barra',        label: 'Barra' },
  { value: 'recreio',      label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
  { value: 'all',          label: 'Geral' },
] as const;

type CollabFull = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  unit: string | null;
  function_title: string | null;
  is_active: boolean;
  onboarding_completed: boolean;
  avatar_url: string | null;
};

export function GestaoEquipeDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role: myRole } = useAuth();
  const queryClient = useQueryClient();

  const { data: collab, isLoading } = useQuery({
    queryKey: ['admin-collaborator', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as CollabFull;
    },
    enabled: !!id,
  });

  // Form state
  const [fullName,      setFullName]      = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [functionTitle, setFunctionTitle] = useState('');
  const [selectedRole,  setSelectedRole]  = useState<Role>('collaborator');
  const [selectedUnit,  setSelectedUnit]  = useState('');
  const [isActive,      setIsActive]      = useState(true);

  useEffect(() => {
    if (collab) {
      setFullName(collab.full_name);
      setPhone(collab.phone ?? '');
      setEmail(collab.email ?? '');
      setFunctionTitle(collab.function_title ?? '');
      setSelectedRole(collab.role);
      setSelectedUnit(collab.unit ?? '');
      setIsActive(collab.is_active);
    }
  }, [collab]);

  const myRank = ROLE_RANK[(myRole as Role) ?? 'collaborator'] ?? 0;
  const allowedRoles = ROLES.filter(r => ROLE_RANK[r] <= myRank);

  // Cargo é INDEPENDENTE do nível de acesso — só cargos reais (sem Coord/Gerente/Diretor).
  const titleOptions = JOB_TITLES;
  // Se o valor salvo no banco não está na lista, inclui para não quebrar a edição
  const allTitleOptions =
    functionTitle && !titleOptions.includes(functionTitle)
      ? [functionTitle, ...titleOptions]
      : titleOptions;

  function handleRoleChange(r: Role) {
    setSelectedRole(r); // não reseta mais o cargo — são independentes
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const newEmail = email.trim().toLowerCase() || null;
      const emailChanged = newEmail !== (collab?.email ?? null);

      if (emailChanged && newEmail) {
        const { data, error } = await supabase.functions.invoke('update-collaborator-email', {
          body: { collaborator_id: id, new_email: newEmail },
        });
        if (error || !data?.ok) {
          throw new Error(
            data?.error === 'email_already_exists'
              ? 'E-mail já está em uso por outra conta.'
              : 'Erro ao atualizar e-mail de login.',
          );
        }
      }

      const { error } = await supabase
        .from('collaborators')
        .update({
          full_name:      fullName.trim(),
          phone:          phone.replace(/\D/g, '') || null,
          email:          newEmail,
          function_title: functionTitle.trim() || null,
          role:           selectedRole,
          unit:           selectedUnit || null,
          is_active:      isActive,
        })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-collaborators'] });
      queryClient.invalidateQueries({ queryKey: ['admin-collaborator', id] });
      showToast({ kind: 'success', title: 'Alterações salvas!' });
    },
    onError: (err: Error) =>
      showToast({ kind: 'error', title: 'Erro ao salvar', msg: err.message }),
  });

  const [resending, setResending] = useState(false);
  async function handleResendLink() {
    const phoneToUse = phone.replace(/\D/g, '') || collab?.phone?.replace(/\D/g, '');
    if (!phoneToUse) {
      showToast({ kind: 'error', title: 'Sem WhatsApp cadastrado.' });
      return;
    }
    setResending(true);
    const { data, error } = await supabase.functions.invoke('send-magic-link', {
      body: { phone: phoneToUse },
    });
    setResending(false);
    if (error || !data?.ok) {
      showToast({ kind: 'error', title: 'Não consegui enviar o link.' });
      return;
    }
    showToast({ kind: 'success', title: 'Link enviado no WhatsApp!' });
  }

  const [deactivating, setDeactivating] = useState(false);
  async function handleDeactivate() {
    if (!confirm(`Desativar ${collab?.full_name}? Ela/ele perderá acesso imediatamente.`)) return;
    setDeactivating(true);
    const { error } = await supabase
      .from('collaborators')
      .update({ is_active: false })
      .eq('id', id!);
    setDeactivating(false);
    if (error) {
      showToast({ kind: 'error', title: 'Erro ao desativar.' });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['admin-collaborators'] });
    showToast({ kind: 'success', title: 'Conta desativada.' });
    navigate('/mais/gestao-equipe');
  }

  if (isLoading) return <LoadingState />;
  if (!collab) return <div className="p-md text-danger">Colaborador não encontrado.</div>;

  const inputCls = 'w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none';
  const chipCls  = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-body-sm font-medium border transition-colors ${
      active ? 'bg-tom text-white border-tom' : 'bg-bg-elevated border-border text-fg'
    }`;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title={collab.full_name}
        subtitle="Editar colaborador"
        backTo="/mais/gestao-equipe"
      />

      {/* Toggle ativo/inativo */}
      <section className="surface p-lg">
        <div className="flex items-center justify-between gap-md">
          <div>
            <div className="text-body-md font-medium">
              {isActive ? '✅ Conta ativa' : '⚪ Conta inativa'}
            </div>
            <div className="text-body-sm text-fg-muted">
              {isActive ? 'Tem acesso ao app' : 'Sem acesso ao app'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsActive(a => !a)}
            aria-label={isActive ? 'Desativar conta' : 'Ativar conta'}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${
              isActive ? 'bg-green-400' : 'bg-fg-subtle'
            }`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
              isActive ? 'right-1' : 'left-1'
            }`} />
          </button>
        </div>
      </section>

      {/* Formulário */}
      <form
        onSubmit={e => { e.preventDefault(); saveMutation.mutate(); }}
        className="space-y-lg"
      >
        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Dados pessoais</h2>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">Nome completo</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">WhatsApp (só dígitos)</label>
            <input type="tel" inputMode="numeric" value={phone}
              onChange={e => setPhone(e.target.value)}
              className={`${inputCls} tabular-nums`} />
          </div>
          <div className="space-y-1">
            <label className="text-body-sm text-fg-muted">E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className={inputCls} />
            <p className="text-body-sm text-fg-muted">
              Alterar e-mail atualiza o cadastro e a credencial de login.
            </p>
          </div>
          <div className="space-y-md">
            <label className="text-body-sm text-fg-muted">Cargo</label>
            <div className="flex flex-wrap gap-2">
              {allTitleOptions.map(t => (
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

        <section className="surface p-lg space-y-md">
          <h2 className="text-label text-fg-muted uppercase tracking-wide">Unidade</h2>
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

        <button type="submit" disabled={saveMutation.isPending}
          className="w-full py-3 rounded-xl bg-tom text-white font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity">
          {saveMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </form>

      {/* Ações secundárias */}
      <div className="space-y-3 px-md">
        <button type="button" onClick={handleResendLink} disabled={resending}
          className="w-full py-3 rounded-xl border border-green-500 text-green-500 font-semibold text-body-md disabled:opacity-50 hover:bg-green-500/10 transition-colors">
          {resending ? 'Enviando...' : '📱 Reenviar link WhatsApp'}
        </button>

        {collab.is_active && (
          <button type="button" onClick={handleDeactivate} disabled={deactivating}
            className="w-full py-3 rounded-xl border border-danger text-danger font-semibold text-body-md disabled:opacity-50 hover:bg-danger/10 transition-colors">
            {deactivating ? 'Desativando...' : 'Desativar conta'}
          </button>
        )}
      </div>
    </div>
  );
}
