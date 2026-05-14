import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Lock, Settings, LogOut, User, Sun, Moon, X, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { showToast } from './Toast';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Boa noite';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dateLong(): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
    timeZone: 'America/Sao_Paulo',
  });
  const s = fmt.format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function initials(name: string | null | undefined) {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

export function Header() {
  const { collaborator, role, signOut, updateProfile, refreshCollaborator } = useAuth();
  const { theme, toggle } = useTheme();
  const [tomFailed, setTomFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwMode, setPwMode] = useState(false);
  const [pw, setPw] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstName = collaborator?.full_name?.split(' ')[0] ?? '';

  useEffect(() => {
    if (!menuOpen) { setPwMode(false); setPw(''); setPwConfirm(''); }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !collaborator?.id) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${collaborator.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatar_url = `${urlData.publicUrl}?t=${Date.now()}`;
      await updateProfile({ avatar_url });
      showToast({ kind: 'success', title: 'Foto atualizada!' });
    } catch (err) {
      showToast({ kind: 'error', title: 'Erro ao enviar foto', msg: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handlePasswordChange() {
    if (pw.length < 6) { showToast({ kind: 'error', title: 'Senha deve ter ao menos 6 caracteres' }); return; }
    if (pw !== pwConfirm) { showToast({ kind: 'error', title: 'Senhas não coincidem' }); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwLoading(false);
    if (error) { showToast({ kind: 'error', title: 'Erro', msg: error.message }); return; }
    showToast({ kind: 'success', title: 'Senha alterada!' });
    setMenuOpen(false);
  }

  const avatarUrl = collaborator?.avatar_url;

  return (
    <header className="w-full max-w-content mx-auto px-md pt-md">
      <div className="flex items-center gap-md">
        {/* Avatar TOM */}
        <div className="h-14 w-14 shrink-0 grid place-items-center" aria-label="TOM, seu agente" title="TOM">
          {tomFailed ? (
            <span className="text-3xl" aria-hidden>👽</span>
          ) : (
            <img src="/tom-avatar.png" alt="TOM" className="h-full w-full object-contain" onError={() => setTomFailed(true)} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-xs text-fg-muted mt-0.5">{dateLong()}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button" onClick={toggle}
            aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
            className="h-8 w-8 grid place-items-center rounded-full bg-bg-elevated border border-border text-fg-muted focus-ring transition-colors hover:bg-bg-subtle"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Abrir menu de perfil"
              aria-expanded={menuOpen}
              title={collaborator?.full_name ?? ''}
              className="h-11 w-11 grid place-items-center rounded-full bg-bg-elevated border border-border overflow-hidden focus-ring transition-colors hover:bg-bg-subtle"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={collaborator?.full_name ?? ''} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-fg">{initials(collaborator?.full_name)}</span>
              )}
              {uploading && (
                <span className="absolute inset-0 bg-black/50 grid place-items-center rounded-full">
                  <span className="text-white text-[10px]">…</span>
                </span>
              )}
            </button>

            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full mt-2 w-64 rounded-md bg-bg-surface border border-border shadow-soft py-1 z-30">
                {/* Header do menu */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-bg-elevated border border-border overflow-hidden shrink-0 grid place-items-center">
                    {avatarUrl
                      ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      : <span className="text-xs font-bold">{initials(collaborator?.full_name)}</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="text-body-sm font-semibold truncate">{collaborator?.full_name ?? 'Sem nome'}</div>
                    <div className="text-body-sm text-fg-muted truncate">{role ?? '—'}</div>
                  </div>
                </div>

                {/* Trocar foto */}
                <button
                  type="button"
                  onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
                >
                  <Camera size={16} className="text-fg-muted" />
                  {uploading ? 'Enviando…' : 'Trocar foto'}
                </button>

                {/* Mudar senha */}
                {!pwMode ? (
                  <button
                    type="button"
                    onClick={() => setPwMode(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
                  >
                    <Lock size={16} className="text-fg-muted" /> Mudar senha
                  </button>
                ) : (
                  <div className="px-3 py-2 space-y-1.5 border-t border-border">
                    <p className="text-body-sm font-medium flex items-center justify-between">
                      Nova senha
                      <button type="button" onClick={() => setPwMode(false)} className="text-fg-muted hover:text-fg"><X size={14}/></button>
                    </p>
                    <input
                      type="password" placeholder="Nova senha" value={pw}
                      onChange={e => setPw(e.target.value)}
                      className="w-full text-body-sm bg-bg-elevated border border-border rounded px-2 py-1.5 focus-ring outline-none"
                    />
                    <input
                      type="password" placeholder="Confirmar senha" value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handlePasswordChange()}
                      className="w-full text-body-sm bg-bg-elevated border border-border rounded px-2 py-1.5 focus-ring outline-none"
                    />
                    <button
                      type="button" onClick={handlePasswordChange} disabled={pwLoading}
                      className="w-full flex items-center justify-center gap-1.5 text-body-sm bg-tom text-white rounded py-1.5 font-medium disabled:opacity-50"
                    >
                      <Check size={14}/> {pwLoading ? 'Salvando…' : 'Salvar senha'}
                    </button>
                  </div>
                )}

                <Link to="/mais" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring">
                  <User size={16} className="text-fg-muted" /> Perfil
                </Link>
                <Link to="/mais/configuracoes" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring">
                  <Settings size={16} className="text-fg-muted" /> Configurações
                </Link>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-body-sm text-danger hover:bg-danger/10 focus-ring border-t border-border mt-1 pt-2"
                >
                  <LogOut size={16} /> Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
