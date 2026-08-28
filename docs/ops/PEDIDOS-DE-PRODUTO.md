# Pedidos de produto vindos da conversa

Achado que **não é bug** — o usuário está pedindo capacidade que o TOM não tem (feature) ou
esbarrando em limitação de arquitetura. O agente de governança registra aqui na ETAPA 2.5 e
**não implementa**: estamos em feature freeze desde 27/07.

Isto existe porque hoje esse pedido morre dentro do finding e ninguém vê a demanda acumulada.
Com a fila, dá pra ver que a mesma pessoa pediu a mesma coisa três vezes.

Uma linha por pedido. Se já existir a linha, **incremente a contagem** em vez de duplicar.

| data | pessoa | o que pediu (literal) | natureza | vezes |
|---|---|---|---|---|
| 31/07 | Rose | "mas ta td misturado trabalho e pessoal ai né, organiza melhor pf" | feature | 1 |
| 25/07 | Rose | "Completo" — queria os 7 lançamentos restantes do extrato | limitação (contexto não persiste entre turnos) | 1 |
| 16/07 | Rose | "já que vc n pode apagar por aqui" — estorno em lote (1ª vez em 11/07 23:44 BRT: "Apaga tudo", 11 lançamentos do Nubank) | feature (Fase B do roadmap financeiro) | 2 |
| 19/06 | Daiana | "Envie às 17:30 um lembrete para a Anne separar todos os cheques..." — recado com horário agendado | feature (o schema do COORDINATION_REQUEST não tem campo de horário de envio) | 1 |
| 22/06 | Rafinha | "Me manda a mensagem do Rodrigo novamente" | limitação (janela de contexto de 30 mensagens; nenhum marker faz retrieval de histórico) | 1 |
| 26/08 | Rafinha | "É esse aqui" (reply-quote a um documento antigo) → depois "Ele é uma planilha" | limitação (`extractQuotedMessage` em `services/whatsapp.js:395` devolve só `{id,text,type,fromMe}` — não baixa mídia citada) + feature (planilha cai em `unsupported_mime`; `services/media.js:189` só aceita `image/*` e `application/pdf`) | 1 |
| 14/08 | Rose | "É pra completar o que falta da fatura pra podermos baixar em contas a pagar / Veja por favor o que falta lançar pra mim?" — importar a fatura inteira e conciliar contra o que já existe | feature (o LLM inventou as ações `import_invoice` e `confirm_invoice_import`; elas **não existem** em `FINANCE_CAN` de `src/finance/finance-capability.js`, nem em `skills/`, `soul/` ou `src/prompts/`) | 4 |
| 27/08 | Dudu | "Poh tom, preciso q anote tudo que te mandei, salva em algum lugar" — confirmação item a item de um lote grande | limitação (a confirmação de bundle vem numa mensagem só e afoga: medido 84 bundles, 15 afogados, 6 com intent aberta sem resposta) | 1 |
