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
| 16/07 | Rose | "já que vc n pode apagar por aqui" — estorno em lote | feature (Fase B do roadmap financeiro) | 1 |
