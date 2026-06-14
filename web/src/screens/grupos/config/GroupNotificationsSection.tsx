// Seção 🔔 Notificações da página de Configurações do grupo. Acordeão em grade 2×2:
// preset desligado = só título + toggle; ligado = revela dia(s) + horário + próximo
// disparo. Linha inteira clicável. Auto-save com debounce — sem botão Salvar.
import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { CustomSelect } from '../../../components/CustomSelect';
import { TimeInput } from '../../../components/TimeInput';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { showToast } from '../../../components/Toast';
import {
  PRESETS, defaultSetting, validateSetting, nextRunLabel,
  loadGroupNotifications, upsertGroupNotification, previewGroupReport, sendGroupReportNow,
  type GroupNotificationSetting, type Preset,
} from '../../../lib/groupNotifications';
import { ReportPreviewModal } from './ReportPreviewModal';

const WD = [
  { v: 1, l: 'S' }, { v: 2, l: 'T' }, { v: 3, l: 'Q' }, { v: 4, l: 'Q' },
  { v: 5, l: 'S' }, { v: 6, l: 'S' }, { v: 7, l: 'D' },
];
const DOM_OPTS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));

export function GroupNotificationsSection({ groupId }: { groupId: string }) {
  const [byPreset, setByPreset] = useState<Record<Preset, GroupNotificationSetting>>(() => ({
    daily_morning: { ...defaultSetting('daily_morning'), enabled: false },
    weekly: { ...defaultSetting('weekly'), enabled: false },
    monthly: { ...defaultSetting('monthly'), enabled: false },
    overdue: { ...defaultSetting('overdue'), enabled: false },
  }));
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [preview, setPreview] = useState<
    { preset: Preset; title: string; loading: boolean; html: string; wontSend: boolean; error: string | null; sending: boolean } | null
  >(null);
  const [confirmSend, setConfirmSend] = useState(false);

  useEffect(() => {
    loadGroupNotifications(groupId).then((rows) => {
      setByPreset((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.preset] = { ...next[r.preset], ...r };
        return next;
      });
    }).catch(() => showToast({ kind: 'error', title: 'Não consegui carregar as notificações' }));
  }, [groupId]);

  function save(preset: Preset, patch: Partial<GroupNotificationSetting>) {
    setByPreset((prev) => {
      const merged = validateSetting({ ...prev[preset], ...patch, preset });
      const next = { ...prev, [preset]: merged };
      clearTimeout(timers.current[preset]);
      timers.current[preset] = setTimeout(() => {
        upsertGroupNotification(groupId, merged)
          .catch(() => showToast({ kind: 'error', title: 'Não consegui salvar' }));
      }, 600);
      return next;
    });
  }

  // "Pré-visualizar" (#3): monta o relatório desse preset só pra ver (não dispara pro grupo).
  async function testarAgora(meta: (typeof PRESETS)[number]) {
    setPreview({ preset: meta.preset, title: meta.label, loading: true, html: '', wontSend: false, error: null, sending: false });
    const r = await previewGroupReport(groupId, meta.preset);
    setPreview((p) => (p && p.preset === meta.preset
      ? (r.ok
          ? { ...p, loading: false, html: r.html, wontSend: (meta.preset === 'overdue' && r.isEmpty), error: null }
          : { ...p, loading: false, error: r.reason })
      : p));
  }

  // "Enviar pro grupo agora": dispara de verdade (app + WhatsApp). Confirmado via ConfirmDialog.
  async function enviarAgora() {
    if (!preview) return;
    const preset = preview.preset;
    setPreview((p) => (p ? { ...p, sending: true } : p));
    const r = await sendGroupReportNow(groupId, preset);
    setConfirmSend(false);
    if (r.ok) {
      showToast(r.sent
        ? { kind: 'success', title: 'Relatório enviado pro grupo' }
        : { kind: 'info', title: 'Sem atrasadas — nada pra enviar agora' });
      setPreview(null);
    } else {
      setPreview((p) => (p ? { ...p, sending: false } : p));
      showToast({ kind: 'error', title: 'Não consegui enviar', msg: r.reason });
    }
  }

  return (
    <>
    <div className="space-y-sm">
      <h3 className="text-body font-semibold text-fg">🔔 Notificações</h3>
      <p className="text-body-sm text-fg-muted">O TOM avisa o grupo automaticamente.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-sm">
        {PRESETS.map((meta) => {
          const s = byPreset[meta.preset];
          const proximo = nextRunLabel(s);
          return (
            <div key={meta.preset} className="rounded-md border border-border bg-bg-surface p-sm">
              {/* Linha inteira clicável (não só o toggle) — liga/desliga e revela os campos. */}
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                aria-label={`${s.enabled ? 'Desligar' : 'Ligar'} ${meta.label}`}
                onClick={() => save(meta.preset, { enabled: !s.enabled })}
                className="flex w-full items-center gap-sm text-left focus-ring rounded-sm"
              >
                <span className="text-lg shrink-0" aria-hidden>{meta.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-body-sm font-medium text-fg truncate">{meta.label}</span>
                  <span className="block text-caption text-fg-muted truncate">{meta.desc}</span>
                </span>
                <span
                  aria-hidden
                  className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${s.enabled ? 'bg-tom border-tom' : 'bg-bg-elevated border-border'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${s.enabled ? 'right-0.5' : 'left-0.5'}`} />
                </span>
              </button>

              {s.enabled && (
                <div className="mt-sm space-y-sm pl-7">
                  {meta.schedule !== 'day_of_month' && (
                    <div className="flex items-center gap-sm">
                      <span className="w-14 text-body-sm text-fg-muted">{meta.schedule === 'single_weekday' ? 'Dia' : 'Dias'}</span>
                      <div className="flex gap-xs">
                        {WD.map((d) => {
                          const sel = s.weekdays.includes(d.v);
                          return (
                            <button
                              key={d.v}
                              type="button"
                              aria-pressed={sel}
                              onClick={() => {
                                const next = meta.schedule === 'single_weekday'
                                  ? [d.v]
                                  : sel ? s.weekdays.filter((x) => x !== d.v) : [...s.weekdays, d.v];
                                // Guard: nunca deixar um preset ligado sem nenhum dia (nunca dispararia).
                                if (next.length === 0) { showToast({ kind: 'info', title: 'Escolhe pelo menos um dia' }); return; }
                                save(meta.preset, { weekdays: next });
                              }}
                              className={`flex h-6 w-6 items-center justify-center rounded text-body-sm ${
                                sel ? 'bg-tom/15 text-tom border border-tom' : 'bg-bg-elevated text-fg-muted border border-border'
                              }`}
                            >{d.l}</button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {meta.schedule === 'day_of_month' && (
                    <div className="flex items-center gap-sm">
                      <span className="w-14 text-body-sm text-fg-muted">Dia</span>
                      <CustomSelect
                        value={String(s.day_of_month ?? 1)}
                        options={DOM_OPTS}
                        onChange={(v) => save(meta.preset, { day_of_month: Number(v) })}
                        size="sm"
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-sm">
                    <span className="w-14 text-body-sm text-fg-muted">Horário</span>
                    <TimeInput value={s.time_local} onChange={(v) => save(meta.preset, { time_local: v })} />
                  </div>

                  <div className="flex items-center justify-between gap-sm pt-xs">
                    {proximo
                      ? <span className="text-caption text-tom">📅 Próximo: {proximo}</span>
                      : <span aria-hidden />}
                    <button
                      type="button"
                      onClick={() => testarAgora(meta)}
                      className="inline-flex items-center gap-xs text-caption text-fg-muted hover:text-tom focus-ring rounded-sm"
                    >
                      <Eye size={12} aria-hidden /> Pré-visualizar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    {preview && (
      <ReportPreviewModal
        title={preview.title}
        loading={preview.loading}
        html={preview.html}
        wontSend={preview.wontSend}
        error={preview.error}
        sending={preview.sending}
        onSendNow={() => setConfirmSend(true)}
        onClose={() => setPreview(null)}
      />
    )}
    <ConfirmDialog
      open={confirmSend}
      title="Enviar agora pro grupo?"
      description="O relatório vai pro chat do grupo e é espelhado no WhatsApp — todo mundo do grupo vê na hora."
      confirmLabel="Enviar agora"
      isPending={!!preview?.sending}
      onConfirm={enviarAgora}
      onClose={() => setConfirmSend(false)}
    />
    </>
  );
}
