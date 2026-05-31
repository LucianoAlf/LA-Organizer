# Review da spec "Fonte Obrigatória + Financeiro Guiado" — do chat advisor

**De:** chat advisor/OCR · **Para:** chat financeiro · **Data:** 2026-05-31

Veredito: direção aprovada. Mover robustez pro engine (pending-state
determinístico) é a correção certa; "app = fonte de verdade" é coerente. 3 catches
+ 2 menores antes de partir pro plano.

## 1. [Crítico] A emissão inicial do marker ainda depende do LLM

A evidência dos logs ("paguei uber no pix" → LLM perguntou de boca, sem emitir
marker = ACTIONABLE_NO_MARKER) é falha de **emissão**, não de resolução. O
pending-state conserta o **turno 2**, mas o **turno 1** ainda precisa do mesmo LLM
emitir em vez de perguntar. "O LLM sempre emite" é o mesmo LLM que acabou de não
emitir.

**Ação:**
- Skill **imperativa e explícita**: "mesmo sem saber a fonte (só 'pix'/'débito'/
  'transferência'), SEMPRE emita `register_transaction` sem `account_name`; NUNCA
  pergunte de boca nem fabrique confirmação — quem pergunta é o engine."
- Manter a métrica/detector ACTIONABLE_NO_MARKER pra pegar regressão.
- Avaliar: o engine pode usar ACTIONABLE_NO_MARKER como **safety-net fraco** —
  ao detectar utterance financeira acionável sem marker, disparar a pergunta de
  fonte determinística? (Se viável, fecha o único ponto mole, que é justo o caso
  que quebrou.)

## 2. [Alto] §8 não fecha o destino das 10 órfãs

"Re-registrar o que importar" está certo, mas as linhas órfãs atuais continuam no
banco. Se ficarem, **dobram a contagem** quando o Alf re-registrar e seguem
poluindo saldo/categoria no PWA.

**Ação:** o plano precisa **deletar as 10 órfãs de teste**
(`account_id IS NULL AND card_id IS NULL`). Deletar dado em produção → **OK
explícito do Alf** (CLAUDE.md). Sem isso, o "sem backfill" deixa lixo somando.

## 3. [Médio] "em dinheiro" com 0 contas contradiz o §1.4

Test #4 ("gastei 20 em dinheiro" → cria/usa Dinheiro, grava) funciona **mesmo com
0 contas**, porque "dinheiro" é fonte explícita. O §1.4 (0 contas → coach pro app,
não grava) vale quando **não** há fonte. Os dois são defensáveis, mas lê como
contradição.

**Ação:** declarar explícito que **"dinheiro" auto-provisiona a carteira Dinheiro
como a única exceção** ao 0-contas→coach. E decidir de propósito: isso permite
usar "em dinheiro" pra sempre sem cadastrar no app (provavelmente ok — caixa é
real, mas que seja intencional).

## Menores

- **3b.** O matcher do pending-state lida com **duas formas** de pergunta: lista
  de fontes ("2"/"nubank") **e** binária cartão-vs-conta (caso `ambiguous`).
  Cobrir ambas.
- **1b.** §1.2 "silencioso": garantir que a confirmação **sempre nomeia a
  principal assumida**, senão um default errado passa batido.

## O resto fecha
Invariante anti-órfã (§6) é o coração certo · receita-sem-cartão escopado limpo ·
P6 no tom certo · injeção de contexto reaproveitada.

## Dependência do OCR (chat advisor)
O OCR depende de `is_primary`, pending-state, P6 e `resolveSource`. O OCR fica
**segurado no spec aprovado** até essa base aterrissar. Quando fechar, o advisor
retoma o plano do OCR.
