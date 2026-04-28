# LA-Organizer-UI-SYSTEM — Design System de Produto

**Documento:** LA-Organizer-UI-SYSTEM  
**Versão:** 2.0  
**Data:** 28 de abril de 2026  
**Função:** Traduzir o branding oficial da LA Music School em um design system de interface para o PWA do LA Organizer, com regras implementáveis para mobile first, dark mode padrão, light mode suportado e responsividade desktop.

---

## 1. Objetivo do documento

Este documento não é só um resumo de branding.
Ele é a **tradução operacional da linguagem visual oficial para produto digital**.

Ou seja: tudo que foi validado no material da marca precisa aparecer aqui em formato que o front-end consiga executar sem improvisar.

### Este documento existe para:
- transformar branding em interface
- evitar decisões subjetivas no front
- definir tokens, hierarquia, componentes e regras de uso
- preservar a identidade da LA Music sem sacrificar usabilidade

---

## 2. Princípio central

O LA Organizer **não é arte de feed** e **não é admin dashboard genérico**.

Ele precisa unir 3 coisas ao mesmo tempo:
- identidade forte da LA Music School
- clareza operacional do TOM
- lógica de uso real para rotina, projeto, time e execução

### Regra de ouro
A marca precisa ser percebida com clareza, mas nunca pode atrapalhar leitura, priorização, escaneabilidade e velocidade de uso.

---

## 3. Direção do produto

### O app deve parecer
- forte
- preciso
- contemporâneo
- musical sem caricatura
- energético sem ruído
- operacional sem cara de software corporativo morto

### O app não deve parecer
- arte de Instagram congelada dentro de uma tela
- dashboard SaaS genérico com pink por cima
- interface enfeitada demais
- produto pesado, cansativo ou barulhento

---

## 4. Premissas de plataforma

### Regras estruturais
- **mobile first** como padrão absoluto de projeto
- **dark mode** como modo primário
- **light mode** oficialmente suportado
- **desktop responsivo** como adaptação consistente do mobile, não redesign separado

### Implicações práticas
- tudo deve nascer pensando primeiro em largura de celular
- o desktop amplia, reorganiza e respira mais, mas preserva a mesma linguagem
- o light mode não muda identidade; só muda o ambiente de contraste

---

## 5. Foundations

## 5.1 Sistema de cores oficial

### Tokens principais de marca
| Token | Hex | Origem | Uso |
|---|---|---|---|
| `brand-primary` | `#E91451` | oficial | cor principal da marca, CTA, destaque, estado ativo |
| `brand-shade` | `#B01545` | oficial derivado | halftone sobre pink, gradientes, profundidade |
| `brand-deep` | `#740A28` | oficial derivado | sombra, marca d’água, container pink profundo |
| `brand-light` | `#F06292` | oficial derivado | hover suave, detalhes leves, pontos de apoio |
| `brand-dark-la` | `#373435` | oficial do SVG | logo em fundo claro, outline escuro, tipografia dark da marca |

### Neutros de base
| Token | Hex | Uso |
|---|---|---|
| `black` | `#0A0A0A` | fundo dark principal |
| `black-soft` | `#141414` | cards em dark, pill preta, superfície secundária |
| `gray-light` | `#E8E8E8` | fundo claro neutro oficial |
| `gray-mid` | `#9E9E9E` | texto secundário, labels, apoio |
| `gray-dark` | `#424242` | texto escuro secundário em light mode |
| `gray-border` | `#E0E0E0` | bordas claras, divisores, linhas |
| `white` | `#FFFFFF` | texto sobre dark/pink, outline claro |

### Tokens funcionais de interface
| Token | Valor |
|---|---|
| `bg-app-dark` | `#0A0A0A` |
| `bg-surface-dark` | `#141414` |
| `bg-elevated-dark` | `#1A1A1A` |
| `text-primary-dark` | `#FFFFFF` |
| `text-secondary-dark` | `#CFCFCF` |
| `text-muted-dark` | `#9E9E9E` |
| `border-dark` | `#2A2A2A` |
| `bg-app-light` | `#F4F4F4` |
| `bg-surface-light` | `#FFFFFF` |
| `bg-subtle-light` | `#E8E8E8` |
| `text-primary-light` | `#111111` |
| `text-secondary-light` | `#424242` |
| `text-muted-light` | `#7A7A7A` |
| `border-light` | `#E0E0E0` |

### Regra de cor
- a marca trabalha com **uma cor principal em múltiplas profundidades**, não com festival de cores
- pink é assinatura de marca, não substitui semântica de sistema
- fundo claro oficial é `#E8E8E8`, nunca cream

---

## 5.2 Hierarquia semântica de interface

O branding oficial não fecha sozinho toda a semântica operacional do app. Portanto, o sistema de produto define as seguintes cores semânticas:

| Token | Hex | Uso |
|---|---|---|
| `semantic-success` | `#22C55E` | tarefa concluída, estado saudável |
| `semantic-warning` | `#F59E0B` | vencimento próximo, atenção |
| `semantic-danger` | `#EF4444` | atraso, bloqueio, falha |
| `semantic-info` | `#3B82F6` | informação neutra, status contextual |
| `semantic-project` | `#8B5CF6` | categoria projeto, roadmap, agrupamento visual |

### Regra semântica
- `brand-primary` nunca substitui erro, aviso ou sucesso
- pink comunica identidade e destaque
- verde, âmbar e vermelho comunicam estado operacional

---

## 5.3 Tipografia oficial

### Família obrigatória
**Prompt**

### Regra estrutural
- usar **Prompt** em todo o produto
- não misturar com Inter, Montserrat, Bebas, Poppins ou qualquer outra família
- a variação visual vem do **peso, caixa, escala e contraste**, não de trocar fonte

### Pesos aprovados
| Peso | Uso principal |
|---|---|
| 300 | apoio leve, casos raros |
| 400 | body |
| 500 | body forte / subtítulo leve |
| 600 | CTA / micro destaque |
| 700 | subtítulo / labels fortes |
| 900 | hero / headline / display |

### Escala tipográfica derivada da marca
| Token | Range | Peso | Uso |
|---|---|---|---|
| `hero` | 96–140px | 900 | branding, splash, login hero |
| `h1-brand` | 50–72px | 900 | título de alto impacto |
| `h2-brand` | 36–48px | 700–900 | títulos grandes de contexto |
| `subtitle-brand` | 20–28px | 700 | subtítulos fortes |
| `cta-text` | 16–20px | 600 | CTA, botões principais |
| `tag-text` | 12px | 700 | tags, microcopy destacada |
| `label-text` | 13px | 500–700 | labels, captions, metadados |
| `body-text` | 15–16px | 400–500 | corpo de interface |
| `handle-text` | 13px | 600 | handle, assinatura, micro elemento |

### Escala operacional do app
Para o PWA, a escala acima precisa ser contida em uso cotidiano:

| Token | Tamanho | Peso | Uso no app |
|---|---|---|---|
| `screen-title` | 24px | 700 | título principal de tela |
| `section-title` | 20px | 700 | bloco / seção |
| `card-title` | 18px | 600 | cards principais |
| `body-lg` | 16px | 500 | conteúdo importante |
| `body-md` | 15px | 400 | corpo padrão |
| `body-sm` | 13px | 400 | apoio |
| `label` | 12px | 700 | chips, status, tabs |

### Regras tipográficas
- pode misturar caixa natural e uppercase em contextos de marca
- no corpo operacional, priorizar legibilidade
- **outline type é linguagem de branding, não tipografia utilitária**
- uma palavra em pink por headline especial é válido; em interface operacional, usar pink só quando houver função real

---

## 5.4 Espaçamento

### Escala oficial derivada dos tokens
| Token | Valor | Uso |
|---|---|---|
| `space-xs` | 4px | gaps finos, micro ícones |
| `space-sm` | 8px | pill interno, micro espaçamento |
| `space-md` | 16px | padding padrão, distância entre elementos |
| `space-lg` | 24px | margem entre blocos, container interno |
| `space-xl` | 32px | safe zone lateral, respiração maior |
| `space-2xl` | 48px | separação entre seções amplas |

### Regras
- base mobile com padding lateral de `16px`
- em telas premium ou respiro maior, usar `24px`
- desktop amplia margens e grid, mas não comprime a semântica do mobile

---

## 5.5 Radius, borda e sombra

| Token | Valor | Uso |
|---|---|---|
| `radius-sm` | 10px | inputs, badges, chips |
| `radius-md` | 16px | cards, nav, containers |
| `radius-lg` | 20px | modais, blocos especiais |
| `radius-brand` | 16–22px | container pink oficial |
| `shadow-soft` | `0 6px 20px rgba(0,0,0,0.22)` | profundidade padrão |
| `shadow-offset-brand` | `8px 8px 0 rgba(0,0,0,0.28)` | container pink com sombra offset |

### Regras
- sombra offset é assinatura forte, usar pontualmente
- não transformar toda a interface em adesivo 3D
- cards operacionais usam sombra discreta ou só contraste de superfície

---

## 6. Elementos gráficos oficiais

Estes elementos existem na marca e foram validados nas peças reais. No produto, eles devem ser usados com disciplina.

### Elementos oficiais
1. **Halftone de pontos**
2. **Marca d’água LA em outline**
3. **Headline sólido + outline**
4. **Container pink com sombra offset**
5. **Chevrons `>>>`**
6. **Footer pill**
7. **Padrão de mais (+)**
8. **Logo no topo**

### Regra de uso no produto
Esses elementos são parte do vocabulário da marca, mas **não são decoração obrigatória em toda tela**.

### Uso permitido forte
- login
- splash
- onboarding curto
- hero de dashboard especial
- empty state de destaque
- cards CTA de alto valor

### Uso contido ou ausente
- listas de tarefa
- tabelas
- formulários
- checklists operacionais
- dashboards analíticos densos
- settings

### Regras específicas
#### Halftone
- usar como textura discreta, nunca poluindo leitura
- preferir cantos, fundos hero e áreas promocionais

#### Marca d’água LA
- usar em baixa opacidade
- ideal em login, hero ou blocos especiais
- não competir com dados e texto

#### Sólido + outline
- só em headline de branding ou contexto especial
- nunca em task rows, labels ou corpo do app

#### Container pink
- excelente para CTA principal, highlight ou card especial
- não usar como padrão para todos os cards

#### Chevrons
- uso micro, de apoio visual e movimento
- nunca como ornamento repetido por toda interface

#### Footer pill
- pode inspirar pills institucionais e CTA social
- não precisa existir em todas as telas do produto

---

## 7. Temas visuais do sistema

### 7.1 Dark Mode — padrão
**Tema principal do app**
- fundo `#0A0A0A`
- superfícies `#141414`
- texto branco e cinzas claros
- pink como destaque controlado

### 7.2 Pink Gradient — uso especial
- reservado para hero, splash, login, CTA forte
- não usar como fundo padrão de tela operacional

### 7.3 Light Mode — suportado
- fundo claro oficial `#E8E8E8` / superfícies brancas
- manter contraste forte
- logo light/dark conforme fundo
- visual mais respirado, menos pesado

### 7.4 Pink Solid — uso controlado
- CTA final
- card destaque
- bloco especial
- nunca como solução dominante para fluxo operacional inteiro

---

## 8. Sistema de logo

### Regra inegociável
**Nunca recriar o logo.**
Usar sempre os SVGs oficiais.

### Variações oficiais
- símbolo solo bicromático
- símbolo solo vazado
- logo completo bicromático
- logo completo vazado
- versões dark/light conforme contraste do fundo

### Regras de aplicação
- **símbolo solo**: avatar, ícone, marca reduzida, watermark
- **logo completo**: login, assinatura, header institucional
- **versão vazada**: fundo com baixa legibilidade ou marca d’água discreta
- **dark vs light**: contraste máximo sempre

---

## 9. Breakpoints e responsividade

| Breakpoint | Largura | Uso |
|---|---|---|
| `mobile` | 0–479px | base absoluta |
| `mobile-lg` | 480–767px | celulares maiores |
| `tablet` | 768–1023px | tablets e transição |
| `desktop` | 1024px+ | desktop responsivo |

### Regras
- desenhar primeiro para **375px**
- o desktop deve parecer expansão natural do mobile
- não criar duas linguagens visuais paralelas
- listas e detalhes podem virar 2 colunas no desktop
- dashboard pode ganhar grid mais amplo e sidebar futura

---

## 10. Componentes base do app

## 10.1 App Shell
### Inclui
- header
- área scrollável
- bottom nav no mobile
- adaptação desktop com header mais largo e navegação expandida quando necessário

### Regra
No Sprint 0, manter arquitetura simples, clara e escalável.

---

## 10.2 Header
### Conteúdo
- título ou saudação
- subtítulo contextual
- avatar ou iniciais
- ação secundária opcional

### Regra
Header limpo, forte e rápido de escanear.

---

## 10.3 Bottom Navigation
### Estrutura
- 4 itens principais
- ícone + label
- estado ativo em `brand-primary`

### Regra
Mobile first real. A navegação precisa funcionar muito bem no polegar.

---

## 10.4 Botões
### Tipos
- `primary`
- `secondary`
- `ghost`
- `danger`

### Regras
- CTA principal da tela precisa ser inequívoco
- usar pink com intenção
- botão primário não pode disputar com 3 outros primários na mesma área

---

## 10.5 Cards
### Tipos
- task card
- project card
- stat card
- CTA card
- section card

### Regra
- cards operacionais são limpos
- card especial pode usar pink, sombra offset ou textura leve
- sempre priorizar hierarquia e leitura

---

## 10.6 Task Row
### Deve suportar
- checkbox
- título
- prazo
- status
- contexto
- responsável opcional

### Regras
- atraso = `semantic-danger`
- próximo prazo = `semantic-warning`
- concluído = `semantic-success`
- estado normal = neutro
- nada de exagero gráfico

---

## 10.7 Project Card
### Deve mostrar
- nome
- progresso
- próxima ação
- categoria
- risco opcional

### Regra
Tem que ajudar a decidir, não só parecer bonito.

---

## 10.8 Stat Card
### Uso
- Hoje
- Semana
- dashboard do time
- visão de projeto

### Regra
Números fortes, label curta, sem ruído.

---

## 10.9 Badge / Pill / Chip
### Uso
- status
- role
- categoria
- contexto
- micro alertas

### Regra
Pode herdar inspiração do footer pill, mas sempre com função.

---

## 10.10 Tabs
### Uso
- detalhe de projeto
- detalhe de pessoa
- filtros rápidos

### Regra
Até 3–4 visíveis; acima disso, scroll horizontal.

---

## 10.11 Modal / Drawer / Bottom Sheet
### Regra
No mobile, dar preferência a bottom sheet ou drawer quando a tarefa for contextual e rápida.

---

## 10.12 Empty / Loading / Error
### Regra
- empty state curto e útil
- loading com skeleton simples
- erro claro com retry quando fizer sentido

---

## 11. Regras por domínio de tela

### Hoje / Semana
- clareza máxima
- pink como acento, não como ruído
- foco em ação e leitura rápida

### Projetos
- pode receber mais linguagem de estrutura e identidade
- ainda assim sem virar peça de campanha

### Dashboard do time
- mais analítico
- menos efeitos da marca
- contraste e leitura acima de tudo

### Configurações / Histórico / Admin
- linguagem discreta
- aparência utilitária

---

## 12. O que herdar e o que não herdar da School

### Herdar
- Prompt
- pink oficial
- contraste forte
- dark mode dominante
- headline com atitude
- container pink especial
- disciplina visual

### Não herdar literalmente
- anatomia de post de feed
- foto full bleed em toda tela
- outline em conteúdo funcional
- halftone constante
- watermark competindo com dados

### Regra-mãe
O PWA precisa **parecer LA Music**, mas se comportar como **produto sério de uso diário**.

---

## 13. Diretriz de light mode

O light mode existe e precisa ser planejado desde já.

### Regras
- não inverter só as cores e chamar isso de light mode
- preservar contraste, hierarquia e assinatura
- fundo claro oficial é `#E8E8E8` e superfícies principais podem ser brancas
- pink continua sendo destaque, não massa visual descontrolada
- usar logo adequada ao fundo

---

## 14. Referência técnica para implementação

### Tokens mínimos a expor em CSS/Tailwind/theme
- cores de marca
- neutros dark/light
- semântica operacional
- tipografia Prompt
- escala de spacing
- radius
- sombras
- regras de contraste

### Obrigatório para o front
- não inventar novas famílias tipográficas
- não inventar novas cores principais
- não transformar branding em ruído visual
- não improvisar outline em interface utilitária

---

## 15. Orientação para Sprint 0

### Telas foco
- Login
- Hoje
- Semana
- Projetos
- Projeto detalhe
- Dashboard do time

### Prioridades do Sprint 0
1. clareza
2. consistência
3. contraste
4. velocidade de leitura
5. identidade controlada
6. responsividade limpa

### Regra final do Sprint 0
Melhor um front limpo, consistente e claramente LA Music do que um front espetaculoso e cansativo.

---

## 16. Decisão final

O LA Organizer não deve ser:
- um admin genérico com pink
- nem uma arte de feed transformada em app

Ele deve ser:
- um sistema de operação com identidade real
- um produto mobile first
- dark mode nativo
- light mode coerente
- desktop responsivo
- branding forte com disciplina visual
- usabilidade acima do enfeite

---

## 17. Uso do documento

Este documento deve ser usado como base para:
- prototipação
- construção do Sprint 0 do PWA
- revisão visual do front
- criação de tokens no código
- auditoria de consistência posterior

Se houver conflito entre branding e usabilidade, a regra é:
**ganha a usabilidade — sem perder a cara da marca.**
