import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Lock, Settings, LogOut, User, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { showToast } from './Toast';

interface TopbarProps {
  sidebarCollapsed?: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Boa noite';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function initials(name: string | null | undefined) {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

export function Topbar({ sidebarCollapsed = false }: TopbarProps) {
  const { collaborator, signOut, updateProfile, sendMagicLink } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  void navigate; // reservado para futuro
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [pw, setPw] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;
  const displayName =
    collaborator?.preferred_name || collaborator?.full_name || '';
  const firstName = displayName.split(' ')[0] ?? '';
  const avatarUrl = collaborator?.avatar_url;

  useEffect(() => {
    if (!pwModal) { setPw(''); setPwConfirm(''); }
  }, [pwModal]);

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
    setPwModal(false);
  }

  return (
    <>
      <header
        className="fixed top-0 right-0 h-14 bg-bg-surface border-b border-border z-30 flex items-center justify-between px-4 lg:px-6 transition-[left] duration-200"
        style={{ left: sidebarWidth }}
      >
        {/* Esquerda: saudação compacta */}
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-body-sm text-fg-muted truncate">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </span>
          <span className="text-body-md font-semibold text-fg truncate">
            {displayName || 'Sem nome'}
          </span>
        </div>

        {/* Direita: theme toggle + avatar com dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggle}
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
              className="h-9 w-9 grid place-items-center rounded-full bg-bg-elevated border border-border overflow-hidden focus-ring transition-colors hover:bg-bg-subtle relative"
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
              <div role="menu" className="absolute right-0 top-full mt-2 w-64 rounded-md bg-bg-surface border border-border shadow-soft py-1 z-50">
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-bg-elevated border border-border overflow-hidden shrink-0 grid place-items-center">
                    {avatarUrl
                      ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      : <span className="text-xs font-bold">{initials(collaborator?.full_name)}</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <div className="text-body-sm font-semibold truncate">{collaborator?.full_name ?? 'Sem nome'}</div>
                    <div className="text-body-sm text-fg-muted truncate">{collaborator?.email ?? '—'}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
                >
                  <Camera size={16} className="text-fg-muted" />
                  {uploading ? 'Enviando…' : 'Trocar foto'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setPwModal(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring"
                >
                  <Lock size={16} className="text-fg-muted" /> Mudar senha
                </button>

                <Link to="/mais/perfil" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-body-sm hover:bg-bg-elevated focus-ring">
                  <User size={16} className="text-fg-muted" /> Perfil
                </Link>
                <Link to="/configuracoes" onClick={() => setMenuOpen(false)}
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
      </header>

      {/* Modal de mudar senha */}
      {pwModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-md"
          onClick={e => { if (e.target === e.currentTarget) setPwModal(false); }}
        >
          <div className="w-full max-w-sm bg-bg-surface border border-border rounded-xl shadow-soft p-6 space-y-4">
            <h2 className="text-lg font-bold">Mudar senha</h2>
            <div className="space-y-2">
              <input
                type="password"
                placeholder="Nova senha (mín. 6 caracteres)"
                value={pw}
                onChange={e => setPw(e.target.value)}
                autoFocus
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none"
              />
              <input
                type="password"
                placeholder="Confirmar nova senha"
                value={pwConfirm}
                onChange={e => setPwConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePasswordChange()}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPwModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-border text-body-sm font-medium hover:bg-bg-elevated transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePasswordChange}
                disabled={pwLoading}
                className="flex-1 py-2.5 rounded-lg bg-tom text-white text-body-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {pwLoading ? 'Salvando…' : 'Salvar senha'}
              </button>
            </div>
            <p className="text-center text-body-sm text-fg-muted">
              Esqueceu a senha?{' '}
              <button
                type="button"
                onClick={async () => {
                  if (!collaborator?.phone) return;
                  await sendMagicLink(collaborator.phone);
                  showToast({ kind: 'success', title: 'Link enviado no WhatsApp!' });
                  setPwModal(false);
                }}
                className="text-tom underline"
              >
                Receber link no WhatsApp
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
