import { useState, useEffect } from 'react';
import { Camera, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/PageHeader';
import { showToast } from '../components/Toast';

function initials(name: string | null | undefined) {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '' + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export function MeuPerfil() {
  const { collaborator, updateProfile, refreshCollaborator } = useAuth();
  const [preferredName, setPreferredName] = useState('');
  const [bio, setBio] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (collaborator) {
      setPreferredName(collaborator.preferred_name ?? collaborator.full_name ?? '');
      setBio(collaborator.bio ?? '');
    }
  }, [collaborator]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !collaborator?.id) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${collaborator.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateProfile({ avatar_url: `${data.publicUrl}?t=${Date.now()}` });
      await refreshCollaborator();
      showToast({ kind: 'success', title: 'Foto atualizada!' });
    } catch (err) {
      showToast({ kind: 'error', title: 'Erro ao enviar foto', msg: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from('collaborators')
      .update({ preferred_name: preferredName.trim(), bio: bio.trim() })
      .eq('id', collaborator!.id);
    setSaving(false);
    if (error) {
      showToast({ kind: 'error', title: 'Erro ao salvar', msg: error.message });
    } else {
      await refreshCollaborator();
      showToast({ kind: 'success', title: 'Perfil salvo!' });
    }
  }

  const avatarUrl = collaborator?.avatar_url;
  const charLeft = 400 - bio.length;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader title="Meu perfil" subtitle="Informações que o TOM usa para te conhecer melhor." backTo="/mais" />

      {/* Avatar */}
      <section className="surface p-lg flex flex-col items-center gap-md">
        <label className="relative cursor-pointer group">
          <div className="h-24 w-24 rounded-full bg-bg-elevated border-2 border-border overflow-hidden grid place-items-center">
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              : <span className="text-2xl font-bold text-fg">{initials(collaborator?.full_name)}</span>
            }
          </div>
          <span className="absolute inset-0 rounded-full bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera size={20} className="text-white" />
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} disabled={uploading} />
        </label>
        <p className="text-body-sm text-fg-muted">
          {uploading ? 'Enviando…' : 'Toque para trocar a foto'}
        </p>
      </section>

      {/* Dados básicos */}
      <section className="surface p-lg space-y-md">
        <h2 className="text-label text-fg-muted uppercase tracking-wide">Como você é chamado</h2>
        <div className="space-y-1">
          <label className="text-body-sm text-fg-muted">Nome preferido</label>
          <input
            type="text"
            value={preferredName}
            onChange={e => setPreferredName(e.target.value)}
            placeholder={collaborator?.full_name ?? ''}
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none"
          />
          <p className="text-body-sm text-fg-muted">Como o TOM vai te chamar nas mensagens</p>
        </div>
      </section>

      {/* Bio */}
      <section className="surface p-lg space-y-md">
        <h2 className="text-label text-fg-muted uppercase tracking-wide">Sobre você</h2>
        <div className="space-y-1">
          <label className="text-body-sm text-fg-muted">Bio — o que o TOM deve saber sobre você</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, 400))}
            placeholder="Ex: Sou professor de violão, tenho TDAH e prefiro ser lembrado várias vezes. Acordo às 9h e não gosto de mensagens antes disso. Minha filha tem 2 anos..."
            rows={5}
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-body-md focus-ring outline-none resize-none"
          />
          <p className={`text-body-sm text-right ${charLeft < 50 ? 'text-warning' : 'text-fg-muted'}`}>
            {charLeft} caracteres restantes
          </p>
        </div>
      </section>

      {/* Info somente leitura */}
      <section className="surface p-lg space-y-md">
        <h2 className="text-label text-fg-muted uppercase tracking-wide">Informações da conta</h2>
        <div className="space-y-2">
          {[
            { label: 'Nome completo', value: collaborator?.full_name },
            { label: 'Email', value: collaborator?.email },
            { label: 'Telefone', value: collaborator?.phone },
            { label: 'Cargo', value: collaborator?.function_title },
          ].map(({ label, value }) => value ? (
            <div key={label} className="flex justify-between gap-2">
              <span className="text-body-sm text-fg-muted">{label}</span>
              <span className="text-body-sm text-right truncate max-w-[60%]">{value}</span>
            </div>
          ) : null)}
        </div>
      </section>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-tom text-white font-semibold text-body-md disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        <Save size={18} /> {saving ? 'Salvando…' : 'Salvar perfil'}
      </button>
    </div>
  );
}
