# 🎵 TOM — LA Organizer

Sistema operacional de vida e trabalho da LA Music.  
Agente WhatsApp com identidade própria, memória evolutiva e skills que se aprimoram com o uso.

## Stack

- **Motor:** Node.js 20 + Express
- **AI:** Claude Sonnet 4.6 (primário) + GPT-5.4 (fallback)
- **Banco:** Supabase PostgreSQL (26 tabelas, 9 domínios)
- **WhatsApp:** UAZAPI
- **Infraestrutura:** Docker + VPS Hostinger

## Setup

### 1. Clonar e configurar

```bash
git clone https://github.com/LucianoAlf/LA-Organizer.git
cd LA-Organizer
cp .env.example .env
# Editar .env com suas credenciais
```

### 2. Subir com Docker

```bash
docker-compose up -d
```

### 3. Verificar

```bash
curl http://localhost:3100/health
```

### 4. Configurar webhook na UAZAPI

Apontar o webhook da instância pra:
```
http://SEU_IP:3100/webhook
```

## Estrutura

```
LA-Organizer/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── src/
│   ├── index.js          ← Entry point (Express + crons)
│   ├── config.js         ← Variáveis de ambiente
│   ├── engine.js         ← Motor central do TOM
│   ├── webhook.js        ← Handler do webhook UAZAPI
│   ├── ai/
│   │   ├── claude.js     ← Cliente Claude (primário)
│   │   ├── openai.js     ← Cliente OpenAI (fallback)
│   │   └── provider.js   ← Switcher com fallback automático
│   ├── services/
│   │   ├── collaborator.js ← Lookup por phone, perfil
│   │   ├── context.js      ← Construtor de contexto (SOUL + perfil + memória)
│   │   ├── ritual.js       ← Dispatcher de rituais (cron)
│   │   └── whatsapp.js     ← UAZAPI sender
│   ├── supabase/
│   │   └── client.js     ← Supabase service_role client
│   └── prompts/
│       └── system.js     ← Montador de system prompt
├── soul/
│   ├── SOUL.md           ← Identidade do TOM (imutável)
│   └── AGENTS.md         ← Regras operacionais
└── skills/
    ├── rituais-diarios.md
    ├── cadastro-projeto-5w2h.md
    ├── priorizacao-eisenhower.md
    ├── broadcast.md
    ├── checklists-operacionais.md
    ├── integracao-emusys.md
    ├── habitos-pessoais.md
    ├── gestao-memoria.md
    ├── onboarding.md
    └── tratamento-audio.md
```

## Arquitetura

```
WhatsApp (UAZAPI) → webhook.js → engine.js → AI (Claude/GPT) → WhatsApp
                                     ↕
                                 Supabase
                              (26 tabelas)
```

O TOM é um motor centralizado. Um único servidor atende todos os colaboradores.  
Cada pessoa tem seu perfil, memória e preferências no banco.  
A cada mensagem, o TOM carrega o contexto da pessoa, chama a IA, e responde.

## Documentação

| Doc | Conteúdo |
|-----|----------|
| soul/SOUL.md | Identidade, personalidade, princípios |
| soul/AGENTS.md | Regras operacionais, permissões por role |
| skills/*.md | Procedimentos detalhados por funcionalidade |

---

*TOM — dá o tom para a organização. LA Music © 2026*

ENDOFFILE
git add README.md && git commit -m "restore: README.md completo" && git push origin main && echo "✅"

