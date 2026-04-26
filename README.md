# 🎵 TOM — LA Organizer

Sistema operacional de vida e trabalho da LA Music.
Agente WhatsApp com identidade própria, memória evolutiva e 10 skills.

## Stack
- **Motor:** Node.js 20 + Express
- **AI:** Claude Code CLI (primário) + Codex CLI (fallback) — via assinatura, sem API keys
- **Banco:** Supabase PostgreSQL (26 tabelas, 9 domínios)
- **WhatsApp:** UAZAPI
- **Infra:** PM2 + Nginx + VPS Hostinger KVM4

## Documentação
Pasta `docs/` — 6 documentos de produto + TOM SOUL/AGENTS/MEMORY/SKILLS/USER

## Arquitetura
WhatsApp → UAZAPI → Nginx :80 → webhook.js :3100 → engine.js → Claude CLI → WhatsApp

*TOM — dá o tom para a organização. LA Music © 2026*
