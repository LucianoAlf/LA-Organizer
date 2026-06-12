// web/src/screens/grupos/chat/MessageBubble.tsx
// Bolha do chat de grupo. HTML SEMPRE via DOMPurify. As AÇÕES do TOM vêm num bloco
// estruturado `‹‹ACTIONS››[json]` no fim do content e são renderizadas como linhas ricas
// com ícones Lucide (não dependem de markdown → hierarquia garantida).
import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Calendar, FolderKanban, ListTodo, ListChecks, Target, StickyNote, CheckCircle2, AlertTriangle, Ban, Trash2 } from 'lucide-react';
import type { ChatMsg } from '../../../lib/groupChat';

const ACTIONS_DELIM = '‹‹ACTIONS››';
const SP = 'America/Sao_Paulo';
function hm(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function firstName(n: string | null) { return (n ?? '').split(' ')[0] || '—'; }
function safeSrc(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}
const PURIFY = { ALLOWED_TAGS: ['b','strong','i','em','u','a','p','br','ul','ol','li','h3','h4','table','thead','tbody','tr','th','td','span','div','code','pre','blockquote'], ALLOWED_ATTR: ['href','target','rel'] };

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noreferrer noopener');
  }
});

type TomAction = { kind: string; status: 'ok' | 'fail'; label: string; detail?: string };

// Baixa o relatório como um documento HTML COMPLETO e estilizado (abre bonito no celular),
// não um fragmento cru. Espelha o visual do card (cabeçalho verde, cartão).
function downloadReportHtml(rawContent: string) {
  const safe = DOMPurify.sanitize(rawContent, PURIFY);
  const doc = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Resumo TOM</title><style>`
    + `body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#eef1e6;color:#1a1a1a}`
    + `.card{max-width:640px;margin:20px auto;background:#fff;border:1px solid #A3BE50;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.08)}`
    + `.bd{padding:18px 4px}h3,h4{background:#A3BE50;color:#1a1a1a;margin:0 0 14px;padding:10px 16px;font-size:16px}`
    + `p{line-height:1.55;margin:0 0 12px;padding:0 16px}ul{margin:0 0 12px;padding:0 16px 0 38px}li{margin:5px 0}em{color:#5a5a5a}strong{color:#1a1a1a}`
    + `</style></head><body><div class="card"><div class="bd">${safe}</div></div></body></html>`;
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'resumo-tom.html'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

const KIND_ICON: Record<string, typeof Calendar> = {
  task: ListTodo, event: Calendar, project: FolderKanban,
  checkpoint: Target, checklist: ListChecks, note: StickyNote,
};

function ActionRow({ a }: { a: TomAction }) {
  const fail = a.status === 'fail';
  const Icon = fail ? AlertTriangle : (KIND_ICON[a.kind] || CheckCircle2);
  return (
    <div className="flex items-start gap-xs">
      <Icon size={15} className={`mt-0.5 shrink-0 ${fail ? 'text-red-600' : 'text-tom-deep'}`} />
      <div className="text-body-sm leading-snug min-w-0">
        <span className="font-semibold break-words">{a.label}</span>
        {a.detail ? <span className="opacity-70"> · {a.detail}</span> : null}
      </div>
    </div>
  );
}

export function MessageBubble({ msg, showAvatar, mine, canDelete, onDelete }: { msg: ChatMsg; showAvatar: boolean; mine: boolean; canDelete?: boolean; onDelete?: () => void }) {
  const isTom = msg.role === 'tom';

  // Apagada (Fase 4 v2): placeholder estilo WhatsApp, ignora conteúdo/mídia/ações.
  if (msg.deleted_at) {
    return (
      <div className={`flex gap-sm mb-xs ${mine ? 'flex-row-reverse' : ''}`}>
        <div className="w-7 shrink-0" />
        <div className={`max-w-[78%] min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
          <div className="px-md py-sm rounded-2xl bg-bg-surface border border-border text-body-sm italic text-fg-muted flex items-center gap-1">
            <Ban size={13} className="shrink-0" /> Mensagem apagada
          </div>
        </div>
      </div>
    );
  }

  // Separa prosa (markdown) do bloco estruturado de ações.
  const { html, actions } = useMemo(() => {
    const content = msg.content || '';
    if (!content) return { html: '', actions: [] as TomAction[] };
    const [proseRaw, actionsRaw] = content.split(ACTIONS_DELIM);
    let parsedActions: TomAction[] = [];
    if (actionsRaw) {
      try {
        const arr = JSON.parse(actionsRaw.trim());
        if (Array.isArray(arr)) parsedActions = arr.filter((x) => x && typeof x.label === 'string');
      } catch { /* ignora bloco corrompido */ }
    }
    const prose = (proseRaw || '').trim();
    const rawHtml = msg.kind === 'report' ? content : (prose ? (marked.parse(prose, { async: false, breaks: true }) as string) : '');
    return { html: rawHtml ? DOMPurify.sanitize(rawHtml, PURIFY) : '', actions: parsedActions };
  }, [msg.content, msg.kind]);

  const avatar = isTom
    ? <img src="/tom-avatar.png" alt="TOM" className="w-7 h-7 rounded-full object-cover shrink-0" />
    : msg.sender_avatar
      ? <img src={msg.sender_avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
      : <span className="w-7 h-7 rounded-full bg-bg-elevated grid place-items-center text-label text-fg-muted shrink-0">{firstName(msg.sender_name)[0]}</span>;

  // tom-tint é creme FIXO (não muda no dark mode), então o texto da bolha do TOM precisa
  // ser sempre escuro — senão herda text-fg (branco no dark) e fica ilegível sobre o creme.
  const bubbleCls = mine
    ? 'bg-tom text-black rounded-2xl rounded-br-sm'
    : isTom
      ? 'bg-tom-tint text-black border border-tom rounded-2xl rounded-bl-sm'
      : 'bg-bg-surface border border-border rounded-2xl rounded-bl-sm';

  const nameLabel = isTom ? 'TOM' : (mine ? 'Você' : firstName(msg.sender_name));

  return (
    <div className={`group flex gap-sm mb-xs ${mine ? 'flex-row-reverse' : ''}`}>
      {/* Avatar agora aparece também nas mensagens próprias (Alf pediu — num grupo confunde sem) */}
      <div className="w-7 shrink-0">{showAvatar && avatar}</div>
      <div className={`max-w-[78%] min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {showAvatar && <div className="text-label text-tom-deep mb-0.5">{nameLabel}</div>}
        <div className={`px-md py-sm ${bubbleCls}`}>
          {msg.kind === 'image' && safeSrc(msg.media_url) && (
            <a href={safeSrc(msg.media_url)} target="_blank" rel="noreferrer"><img src={safeSrc(msg.media_url)} alt={msg.media_filename ?? ''} className="rounded-md max-h-60 mb-xs" /></a>
          )}
          {msg.kind === 'audio' && safeSrc(msg.media_url) && (
            <audio controls src={safeSrc(msg.media_url)} className="max-w-full mb-xs" />
          )}
          {msg.kind === 'pdf' && safeSrc(msg.media_url) && (
            <a href={safeSrc(msg.media_url)} target="_blank" rel="noreferrer" className="flex items-center gap-xs text-body-sm underline mb-xs">📄 {msg.media_filename ?? 'documento.pdf'}</a>
          )}
          {html && (
            msg.kind === 'report'
              ? <div className="rounded-md border border-tom overflow-hidden text-body-sm break-words [&_h4]:bg-tom [&_h4]:text-black [&_h4]:px-sm [&_h4]:py-xs [&_h4]:font-bold [&>div]:p-sm [&_li]:my-0.5" dangerouslySetInnerHTML={{ __html: html }} />
              : <div className="text-body-sm leading-relaxed break-words [&_a]:underline [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {actions.length > 0 && (
            <div className={`flex flex-col gap-1 ${html ? 'mt-1.5 pt-1.5 border-t border-tom/30' : ''}`}>
              {actions.map((a, i) => <ActionRow key={i} a={a} />)}
            </div>
          )}
          <div className={`text-[10px] mt-0.5 ${mine || isTom ? 'text-black/60' : 'text-fg-muted'}`}>{hm(msg.created_at)}</div>
        </div>
        <div className="flex gap-xs mt-xs items-center">
          {msg.kind === 'report' && (
            <button type="button" onClick={() => downloadReportHtml(msg.content ?? '')} className="text-label text-fg-muted hover:text-fg">⬇ Baixar HTML</button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Apagar mensagem"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition text-fg-muted hover:text-red-600 p-0.5"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
