# TOM — Descarga de demandas: memória durável + "registrei" honesto

**Data:** 2026-06-02
**Origem:** Áudios com várias demandas (a feature mais usada) falham em produção: o TOM **perde itens**, **mente o "registrei"** (afirma que salvou coisas que ficaram só na conversa), e **dispara pra pessoas sem confirmar**. Causa raiz confirmada (3 camadas): regra inviolável *"uma pergunta por vez / máx 3-4 linhas"* fazia o TOM parar no 1º item; nada forçava cobrir a lista toda; nada persistia a lista → o resto vivia na "memória" dele e sumia.

**Objetivo:** resolver os 3 problemas **sem transformar o TOM num formulário**. A inteligência dele continua dele; a gente só adiciona **memória** e **honestidade**, e **poda** as regras que o travam.

---

## Princípio de design (NÃO violar)
> Menos regra, não mais. A correção é dar ao TOM **um caderno** (lista persistida) e **um princípio leve** (espelha → confirma → resolve o seu, guia o resto), e **remover** os trilhos rígidos que o engessam. Nada de máquina de estados no engine forçando passos. O *como* (palavras, agrupamento, jogo de cintura) é juízo do TOM.

## Escopo (versão enxuta — o que entra)
1. **Memória da descarga (persistir a lista).** Quando o decompositor detecta **≥2 demandas**, a lista de itens é **gravada no banco** (reusar `pending_intents`, novo `kind='intake_list'`, payload `{ items: [{ idx, text, status: 'pending'|'done'|'dropped' }], origin }`). Se a conversa cair/parar, a lista **sobrevive** e o TOM pode retomar ("você ainda tem 3 itens daquela descarga").
2. **"Registrei" honesto.** O TOM só afirma "registrei/criei/anotei *X*" quando o marker correspondente **foi de fato persistido** (o engine já sabe o que salvou). Recado/aviso enviado a alguém **≠** "registrado". Reforço aplicado ao contexto de lista (estende regras #12/#20 que já existem).
3. **Podar o que trava.** No contexto de descarga, **remover/abrandar** "uma pergunta por vez" e "máximo 3-4 linhas" (já iniciado nas Regras 5/5b — revisar pra ficar **coerente e enxuto**, sem conflito).
4. **Princípio leve da descarga (orientação, não script).** Um bloco curto: *"ao receber uma descarga: espelhe a lista numerada (inclusive o que não entendeu, com ❓), confirme com o Alf, então resolva o que é dele e está completo, e pergunte o que falta — usando seu juízo."* O confirmar-antes-de-disparar-pra-pessoa (já no ar) permanece.

## Fora de escopo (camada futura, só se precisar)
- Wizard rígido "um a um" item por item (camada opcional, só se o leve não bastar).
- Tela no PWA pra ver/gerenciar a descarga.
- Tracking fino por-item (matching marker↔item) além do best-effort — v1 reconcilia a lista contra as tasks reais já criadas.

## Bugs relacionados (tratar junto, tocam a honestidade)
- **Engine — dedup sequestra a resposta + aborta o lote** (`engine.js:1623` substitui o texto do TOM por SÓ o prompt de duplicata; `engine.js:4004` `return` no 1º soft-dup abandona o resto do batch). Corrigir: o aviso de duplicata **não pode** apagar a resposta inteira nem matar os outros itens.
- **Resolução de homônimo** (`resolveCollaboratorByName`): "Dai do recreio" foi pro Dai errado. Bug separado; o confirmar-antes já mitiga (o Alf corrige na confirmação). Fica pra depois, salvo se trivial.

## Componentes tocados
- `src/services/audio-decompose.js` / `src/engine.js`: ao detectar ≥2 demandas, **persistir** a lista (pending_intents `intake_list`). Marcar itens conforme o TOM age (best-effort, reconciliando com tasks criadas).
- `src/prompts/system.js`: **podar** o conflito (Regra 5/5b enxuta) + princípio leve da descarga + reforço do "registrei honesto". Líquido: idealmente **menos** texto, não mais.
- `src/services/pending-intents.js`: suportar `kind='intake_list'` (guardar/ler/atualizar a lista).

## Como validamos que ele continua ESPERTO (teste de fumaça)
- **Curveball:** mandar uma descarga **bagunçada de propósito** — item pela metade, uma ironia, um "ah, deixa quieto" no meio, uma pessoa ambígua. Esperado: responde com **jogo de cintura** (espelha, pergunta o confuso, ignora o "deixa quieto"), **não** robotizado. Se robotizar → afrouxar regra.
- **Banco:** a lista persiste (`intake_list`); "registrei" só pros itens que viraram task de verdade; **nada** disparado pra pessoa sem o "sim".
- **Regressão:** mensagem simples (1 demanda) continua leve e direta (a poda não pode deixar o TOM prolixo no dia a dia).

## Critério de sucesso
Numa descarga de ~8 itens com gente no meio: **0 itens perdidos**, **0 "registrei" falso**, **0 disparo sem confirmar**, e a resposta **soa humana/inteligente** (não formulário). A lista pendente fica no banco, recuperável.
