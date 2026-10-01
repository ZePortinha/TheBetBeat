# BETBEAT — Brief de construção (Claude Code)

Este ficheiro é a fonte de verdade do projeto.
- **Parte A:** como trabalhar.
- **Parte B:** especificação do produto.
- **Parte C:** fases e critérios de conclusão.

Vem acompanhado da skill **`apple-design`** (ficheiro `SKILL.md`), que define como a interface responde e se move. Ver A2 (regra 14) e A3.

Se estás a começar o projeto, começa pela Fase 0. Caso contrário, lê `docs/PROGRESS.md` e retoma a partir do próximo passo.

---

## PARTE A — COMO TRABALHAR

### A1. Missão

Construir o BetBeat com qualidade de produção: uma plataforma em que os convidados de uma discoteca pagam para pedir músicas ao DJ, com preço dinâmico, um cockpit profissional para o DJ e uma consola para a casa.

Prioridades, por esta ordem:
1. Segurança e fiabilidade do dinheiro.
2. Rapidez e simplicidade para o convidado.
3. Clareza e controlo para o DJ.
4. Estética premium.

### A2. Regras de execução

1. **Uma fase de cada vez.**
   - No fim de cada fase (Parte C):
     - todas as verificações estão verdes;
     - `docs/PROGRESS.md` está atualizado;
     - fazes commit;
     - paras e apresentas um resumo: o que foi feito, como testar localmente, o que vem a seguir e que decisões precisam de aprovação.
   - Não avanças sem a minha aprovação.
2. **A Fase 0 é só leitura e plano.** Não crias nem alteras ficheiros antes de eu aprovar o plano.
3. **Fonte de verdade.** É este brief.
   - Se encontrares uma contradição ou um erro, propõe a correção antes de a aplicar.
   - Quando algo não estiver especificado, escolhe a opção mais simples coerente com os princípios de B1 e regista-a em `docs/DECISIONS.md`.
4. **Línguas.**
   - Código, nomes, comentários e commits em inglês.
   - Textos de interface em pt-PT, e também em EN na app do convidado. Ficam sempre em ficheiros de tradução, nunca escritos diretamente nos componentes.
5. **Dados.**
   - Usa só dados fictícios e genéricos: casas, DJs, faixas e convidados. Nunca nomes reais e nada de lorem ipsum.
   - Se receberes imagens de referência, usa-as apenas como ambiente visual. Não copies textos, nomes nem números.
6. **Integrações externas.** Até à Fase 8, PSP, SMS, faturação e catálogo musical são mocks atrás de interfaces. Nunca precisas de contas reais para avançar.
7. **Segredos e git.**
   - Nenhum segredo no código nem no histórico do git (B12.1). Os valores reais ficam só em `.env.local`.
   - Mantém `.env.example` completo e comentado, sem valores reais.
   - Nunca fazes push nem operações destrutivas no git sem eu pedir.
8. **Verificação contínua.** Depois de cada alteração relevante, corre `pnpm typecheck`, `pnpm lint` e `pnpm test`. Nada está concluído com testes a falhar ou erros de tipos.
9. **Verificação visual.**
   - Para cada ecrã, tira screenshots com Playwright nos viewports que lhe correspondem:
     - telemóvel 393×852;
     - iPad 1194×834;
     - TV 1920×1080 e 1080×1920.
   - Revê-os contra o design system (B10) e corrige o que for preciso antes de fechar a fase.
   - Revê também as animações-chave em câmara lenta, frame a frame (por exemplo, com as animações abrandadas no Playwright).
10. **Segunda opinião no dinheiro e na segurança.** Antes de fechar as Fases 2, 3 e 8, pede a um subagente uma revisão independente do código de preço, pagamentos, reembolsos e ledger, e da checklist de segurança (B12). Corrige o que ele encontrar.
11. **Documentação oficial.** Quando não tiveres a certeza de uma API (Next.js, Supabase, pg-boss, Playwright…), consulta a documentação oficial antes de escrever código. Usa as versões estáveis atuais.
12. **Dependências.** Usa só as da stack (B11) e as estritamente necessárias. Antes de instalar, confirma o pacote (B12.6). Cada dependência nova fica justificada em `docs/DECISIONS.md`.
13. **Bloqueios.** Se precisares de algo que só eu posso dar (credenciais, contas, decisões legais ou de negócio), pergunta e continua com o que não depende disso.
14. **Skill `apple-design`.**
    - Carrega-a antes de construir ou rever qualquer ecrã, componente, gesto ou animação.
    - A skill define como a interface responde e se move. B10 define a marca: cores, tipografia e voz.
    - Se houver conflito, B10 prevalece e registas a decisão em `docs/DECISIONS.md`.

### A3. Ficheiros de projeto (criados na Fase 1)

- **`CLAUDE.md`** (menos de 200 linhas):
  - Conteúdo:
    - o produto em 3 linhas;
    - stack, comandos e mapa de pastas;
    - convenções;
    - as regras inegociáveis de B1 e B4;
    - o essencial de A2.
  - Inclui a regra: "No início de cada sessão, lê `docs/PROGRESS.md` e retoma a partir do próximo passo."
  - Refere este brief entre backticks e sem `@`, para não ser carregado em todas as sessões.
- **`.claude/skills/apple-design/SKILL.md`:** se a skill estiver na raiz como `SKILL.md`, move-a para este caminho sem a alterar. Se não estiver, pede-ma.
- **`.claude/rules/`**, com regras por caminho (frontmatter `paths`):
  - `security.md`
    - Sem `paths`: carregada em todas as sessões.
    - Conteúdo: resumo de B12 em menos de 30 linhas.
  - `money.md`
    - Caminhos: `lib/payments/**`, `lib/ledger/**`, `lib/domain/**` e `worker/**`.
    - Regras: cêntimos inteiros, idempotência, transições só no servidor e auditoria.
  - `pricing.md`
    - Caminho: `lib/pricing/**`.
    - Regras: funções puras, sem I/O, `now` injetado e testes obrigatórios.
  - `ui.md`
    - Caminhos: `app/**` e `components/**`.
    - Regras: só tokens, strings só em traduções, alvos de toque, a checklist de interação de B10.6, reduced motion e reduced transparency. Usa a skill `apple-design`.
- **`docs/PROGRESS.md`:** estado de cada fase, próximo passo e problemas conhecidos.
- **`docs/DECISIONS.md`:** cada decisão com data, contexto e alternativa rejeitada.
- **Este brief:** se ainda não estiver no repositório (porque foi colado na conversa), guarda-o literalmente, sem resumir, em `BETBEAT_BRIEF.md`.

---

## PARTE B — ESPECIFICAÇÃO

### B1. Produto

**O que é.** Os convidados de uma discoteca pagam para pedir uma música ao DJ e escolhem quanto tempo estão dispostos a esperar. O DJ decide sempre o que toca. A casa ganha uma nova fonte de receita sem hardware.
- Mercado inicial: Portugal, em EUR e no fuso Europe/Lisbon.
- Arquitetura preparada para outros mercados.

**Valor para cada lado**
- **Convidado:** influência real na música em menos de 30 s, sem instalar nada e com reembolso garantido.
- **DJ:** receita extra, leitura da procura em tempo real e controlo artístico total.
- **Casa:** receita incremental por convidado, mais envolvimento e dados.

**Princípios inegociáveis**
1. O DJ tem a última palavra. Nada toca sem ser aceite.
2. Se não tocar, o convidado não paga: reembolso total e automático. Se a promessa de tempo falhar, devolve-se a diferença.
3. Do QR ao pagamento em menos de 30 s, sem registo nem palavra-passe.
4. Preço final, tempo estimado e regras visíveis antes de pagar.
5. Tempo real: menos de 1 s entre o pagamento confirmado e o alerta na cabine.
6. Desenhado para o escuro, o barulho e uma mão ocupada.
7. Não é jogo: o resultado é determinístico, sem sorte nem prémios. Proibido na interface: "aposta", "apostar", "odds", "ganhar".

**Crescimento**
- O Ecrã da Casa (com o QR sempre visível) e o cartão partilhável "A minha música tocou" trazem novos convidados.
- Cada DJ que ganha com o BetBeat leva-o para as próximas casas onde toca.
- Cada pedido gera dados de procura (por casa, hora e género) que alimentam os preços.

### B2. Superfícies (uma única app Next.js)

- **`/s/[qrToken]` — App do Convidado:** PWA para telemóvel, em pt-PT e EN.
- **`/cockpit` — Cockpit do DJ:** PWA para iPad em landscape.
- **`/display/[token]` — Ecrã da Casa:** para TV ou LED, sem interação.
- **`/console` — Painel da Casa e Admin BetBeat:** desktop, com acesso por papéis.

**Fora do MVP** (não construir, mas deixar a arquitetura preparada):
- Deteção automática da faixa a tocar (Pro DJ Link ou histórico do software de DJ).
- Vários convidados a financiar o mesmo pedido.
- Modelo de elasticidade de preço com ML.
- Preços por zona.
- App nativa.
- Insights para artistas.

### B3. Glossário (interface ↔ código)

- **Níveis:** "Na Fila" = `QUEUE`, "Em Breve" = `SOON`, "A Seguir" = `NEXT`.
- **Entidades:** casa = `Venue`, zona = `Zone`, set/sessão = `Session`, pedido = `Request`, cotação = `Quote`, pagamento = `Payment`, reembolso = `Refund`, lançamento = `LedgerEntry`, liquidação = `Payout`.
- **Superfícies:** `guest`, `cockpit`, `display`, `console`.

### B4. Regras de negócio

**B4.1 Níveis (cada nível é uma promessa de tempo)**

- **`QUEUE`**
  - Toca durante o set, pela ordem da fila.
  - Se não tocar até ao fim do set: reembolso total.
- **`SOON`**
  - Toca até 20 min após o pagamento. A capacidade é limitada (ver B5.2).
  - Se o prazo falhar, o pedido passa a `QUEUE` e devolve-se de imediato a diferença para o preço `QUEUE` da cotação original.
  - Se não tocar até ao fim do set: reembolso total.
- **`NEXT`**
  - Toca na próxima transição, até 10 min após o pagamento.
  - Só pode haver 1 ativo de cada vez.
  - Mesmas garantias que `SOON`.
- **Valor livre**
  - O convidado pode pagar acima do preço do nível.
  - Dentro do nível, valores maiores aparecem primeiro ao DJ.
  - Pagar mais nunca ultrapassa a promessa de outro nível.
- **Subir de nível**
  - Paga-se só a diferença para o preço atual do novo nível.
  - O prazo conta a partir da subida.
- **Janela de decisão do DJ:** 3 min para `NEXT`, 5 min para `SOON` e 10 min para `QUEUE`. Sem decisão dentro da janela: reembolso total.
- Prazos, capacidades e janelas são configuráveis por sessão.

**B4.2 Ciclo de vida do pedido**

- **Estados:** `pending_payment → paid → accepted → playing → played`, mais `expired` e `refunded`.
- **Motivos de fecho (`closeReason`):**
  - `payment_timeout` → `expired`.
  - `rejected_by_dj`, `dj_timeout`, `cancelled_by_dj` e `session_ended` → `refunded`.
- **Prazo falhado (`sla_missed`):**
  - O worker verifica-o no fim do prazo.
  - Se o pedido não estiver `playing` nem `played`, passa a `QUEUE` e a diferença é devolvida. Nos cartões, reduz-se o valor a capturar.
  - O pedido continua na fila.
- **Faixa tocada:** `played` é automático, após a duração da faixa ou quando o DJ marca a seguinte.
- **Transições:**
  - Só o servidor faz transições.
  - Cada transição gera um `request_event` e um registo de auditoria.
  - A máquina de estados é uma função pura em `lib/domain`, com `now` injetado e testes exaustivos.
- **Fecho automático:** uma sessão que o DJ não termine fecha sozinha 30 min após a hora de fim, com os reembolsos devidos.

**B4.3 Pagamentos**

- **Métodos:** MB WAY, Apple Pay, Google Pay e cartão. Cartões e wallets são essenciais para turistas.
- **Interface `PaymentProvider`:** `authorize`, `capture` (total ou parcial), `void`, `charge`, `refund`, `getStatus` e `verifyWebhook`.
- **`MockPaymentProvider` desde o início**, com um painel de desenvolvimento que simula:
  - MB WAY confirmado, recusado e expirado;
  - autorizações de cartão;
  - falhas de rede;
  - webhooks duplicados.
- **PSP real só na Fase 8.** Tem de suportar MB WAY, cartões, wallets e marketplace (split e payouts).
- **Cartões e wallets:**
  - Autoriza no pedido e captura só quando a música toca.
  - Se o prazo falhar, captura só o valor `QUEUE`.
  - Se não tocar, anula a autorização.
- **MB WAY:**
  - Cobrança imediata, com reembolso automático quando aplicável.
  - Telemóvel +351.
  - Timeout configurável (4 min por defeito), com contagem visível e opção de reenviar.
- **Validação da cotação:**
  - O cliente nunca envia preços: envia o `quoteId` e o servidor valida a cotação (válida durante 120 s).
  - Ao iniciar o pagamento, o preço fica fixo e o lugar no nível fica reservado até à confirmação ou à expiração.
  - A reserva é feita numa transação com bloqueio, para que o mesmo lugar nunca seja vendido duas vezes.
- **Robustez:** idempotência em todas as operações, webhooks com assinatura verificada e reconciliação diária automática.

**B4.4 Reembolsos**

- **Automáticos** em todos os casos de B4.1 e B4.2.
- **Exatamente uma vez**, com uma chave de idempotência por pedido e motivo.
- **Em caso de falha:** retry com backoff e alerta ao admin.
- **Aviso ao convidado:** no ecrã, e também por SMS ou email se os tiver dado.
- **Taxas:** as do PSP nunca são descontadas ao convidado.

**B4.5 Receita, split e faturação**

- **Split por pedido:**
  - Taxa BetBeat configurável (20% por defeito).
  - O restante divide-se entre a casa e o DJ, com o split configurável por sessão.
- **Ledger:** de dupla entrada e imutável. Os saldos são sempre derivados dele.
- **Payouts:** à casa e ao DJ após o fecho da sessão (SEPA via PSP), com relatório.
- **Faturação:**
  - Preços com IVA incluído.
  - `InvoicingProvider` para software de faturação certificado pela AT: fatura-recibo, com NIF opcional no checkout.
  - Entidade emissora configurável (BetBeat ou casa), a validar com o contabilista.

**B4.6 Catálogo**

- **Por defeito, biblioteca do DJ:**
  - Importada de rekordbox XML ou CSV, com BPM, tonalidade e género.
  - Maximiza a aceitação.
- **Alternativa por sessão, biblioteca + catálogo global:**
  - Via `CatalogProvider`: pesquisa, capas e previews de 30 s.
  - As faixas fora da biblioteca ficam marcadas para o DJ.
- **Regras:**
  - Géneros, artistas e faixas bloqueáveis.
  - Uma faixa tocada há menos de 60 min não pode ser pedida.
  - Um pedido ativo por faixa ("Já pedida · toca em ~X min").

**B4.7 Limites e proteção**

- **Por convidado:** no máximo 3 pedidos ativos e um limite de gasto por noite (150 € por defeito).
- **Rate limiting:** por dispositivo, número e IP.
- **QR codes assinados (HMAC):** o token identifica casa, sessão e zona e não pode ser forjado.
- **Mensagem opcional com o pedido:**
  - Até 60 caracteres, com filtro de linguagem.
  - Aprovação do DJ antes de ser pública.
  - Desligada por defeito.

### B5. Motor de preço (`lib/pricing`)

- **`computeQuote(input, now)`** é uma função pura: sem I/O, determinística e totalmente testada.
- **Serviço de cotações** (fora de `lib/pricing`): gera o id e a expiração e persiste cada cotação.
- **Parâmetros:** todos vêm da configuração da casa ou da sessão, com os defeitos abaixo.

**B5.1 Entradas**

- **Sessão:**
  - preço base `B` (10 € por defeito);
  - ritmo `R`, ou seja, pedidos que o DJ aceita tocar por hora (8 por defeito);
  - hora de fim;
  - limites por nível;
  - últimos fatores publicados (para a suavização).
- **Fila:** pedidos ativos (pagos e por tocar), com nível, valor, hora e duração.
- **Faixa:** género, BPM e tonalidade.
- **Set:** BPM e géneros das últimas 5 faixas.
- **Casa:** multiplicadores por género `M_g`.

**B5.2 Fórmulas**

- **Pressão:** `rho = activeRequests / R`, ou seja, horas de fila acumulada.
  - Procura baixa: < 0.3.
  - Média: ≤ 0.7.
  - Alta: ≤ 1.2.
  - Muito alta: > 1.2.
- **Fator procura:** `D = clamp(0.85 + 0.5·rho, 0.85, 2.0)`.
- **Fator encaixe:** `F = 1 + 0.5·(1 − S)`, com `S` definido em B5.3. Uma faixa fora do estilo custa até +50%.
- **Preço `QUEUE`:** `P_q = B · M_g · F · D`.
- **Preço `SOON`:** `P_s = P_q · 2.0 · (1 + o²)`.
  - `o = activeSoon / C_s`, com `C_s = max(1, floor(R · 20 / 60))`.
  - Se `o ≥ 1`, o nível fica indisponível.
- **Preço `NEXT`:** `P_n = P_q · 3.5`. Só está disponível se não houver outro `NEXT` ativo.

**Exemplo (teste obrigatório):**
- Entradas: B = 10 €, M_g = 1, S = 0.9, 3 pedidos ativos, R = 8 e 1 `SOON` ativo (C_s = 2).
- Fatores: rho = 0.375, D = 1.0375, F = 1.05.
- Preços:
  - `QUEUE`: 10,89 € → **11 €**
  - `SOON`: 27,23 € → **25 €**
  - `NEXT`: 38,13 € → **40 €**

**B5.3 Encaixe musical `S` ∈ [0, 1]**

- **Género `s_g`:**
  - 1 se pertence aos géneros da sessão;
  - 0.6 se é adjacente (mapa configurável, com defeitos sensatos);
  - 0.2 nos restantes casos.
- **BPM:** `s_b = max(0, 1 − Δ/16)`. Δ é a menor diferença entre o BPM da faixa (×0.5, ×1 ou ×2) e a mediana do set.
- **Tonalidade `s_k`:**
  - 1 se é compatível na roda Camelot (mesma tonalidade, ±1 ou relativa);
  - 0.5 se não é;
  - 0.75 se é desconhecida.
- **Combinação:** `S = 0.5·s_g + 0.35·s_b + 0.15·s_k`.
- **Etiquetas:**
  - `fits` — "Encaixa no set" (≥ 0.7);
  - `possible` — "Transição possível" (0.4–0.7);
  - `off_style` — "Fora do estilo" (< 0.4).
- O convidado vê o aviso antes de pagar. A sessão pode bloquear pedidos abaixo de um S mínimo.

**B5.4 Recomendação por género (`M_g`)**

- **Arranque:** `M_g = 1.0` para todos os géneros.
- **Job semanal, por casa:** corre para cada género com pelo menos 30 cotações nos últimos 30 dias.
  - Métricas:
    - `conversion = paid / quotesShown`;
    - `demand = quota do género / quota média`.
  - Ajuste:
    - conversion > 35% e demand > 1 → `+0.05`;
    - conversion < 15% → `−0.05`;
    - nos restantes casos, mantém.
  - Limites: [0.8, 1.3].
- **Consola:** mostra, por género, o preço recomendado (`B·M_g`), a conversão, o volume, a receita e o motivo. A casa aprova, ajusta ou ativa a aplicação automática.
- **v2:** modelo de elasticidade, com a mesma interface.

**B5.5 ETA e ordem**

- **Intervalo entre pedidos:** `i = 60 / R` min.
- **ETA por nível:**
  - `NEXT`: tempo restante da faixa atual (ou `i/2`).
  - `SOON`: `(nNext + posição) · i`.
  - `QUEUE`: `(nNext + nSoon + posição) · i`.
- **Ordem dentro de cada nível:**
  - Primeiro, os pedidos a menos de 5 min de falhar o prazo.
  - Depois, por `amount × (1 + 0.01 · minutosEmEspera)`, para que nenhum pedido antigo fique esquecido.
- **Disponibilidade:** um nível cujo ETA ultrapasse a sua promessa fica indisponível. Em `QUEUE`, a promessa é o fim do set ("Sem lugar neste set").
- **Apresentação:** "~X min", ao minuto até 10 min e em múltiplos de 5 acima disso.

**B5.6 Proteções**

- **Limites por defeito:** `QUEUE` 5–60 €, `SOON` 15–120 €, `NEXT` 25–200 €.
- **Ordem garantida:** cada nível custa pelo menos mais 5 € do que o anterior. A Consola rejeita configurações que tornem isto impossível.
- **Arredondamento:** ao euro abaixo de 20 €; a múltiplos de 5 € a partir de 20 €.
- **Estabilidade:** `D` e o fator de ocupação são publicados por sessão e variam no máximo ±15% por minuto.
- **Sequência de cálculo:** calcular → suavizar → limitar → arredondar → impor a ordem → validar.
- **Valores válidos:** nunca NaN, negativos ou fora dos limites.

**B5.7 Saída**

- **`computeQuote` devolve:**
  - `fit { score, label }`;
  - `demand { rho, level }`;
  - `tiers[]` com `{ tier, priceCents, etaMin, available, reason? }`;
  - `breakdown { base, genreMultiplier, fitFactor, demandFactor, occupancy }`.
- **O serviço de cotações acrescenta** `quoteId` e `expiresAt` e persiste cada cotação, para medir a conversão e para auditoria.

**B5.8 Testes obrigatórios**

- Fila vazia: preços perto da base e ordem garantida.
- Procura a subir: o preço sobe, mas nunca acima do máximo.
- `SOON` a encher: o preço sobe. Quando está cheio, fica indisponível e mostra o ETA de libertação.
- `NEXT` ocupado: indisponível.
- Faixa fora do estilo: no máximo +50%, com a etiqueta certa.
- 30 pedidos num minuto: o preço varia no máximo 15%.
- O exemplo de B5.2.
- Testes baseados em propriedades (fast-check), sem nenhum valor inválido.

**B5.9 Simulador (na Consola)**

- **Controlos:** B, R, pedidos ativos, ocupação, género e encaixe.
- **Visualização:** gráfico ao vivo dos três preços e tabela com o breakdown.

### B6. App do Convidado (`/s/[qrToken]`)

**Fluxo:** QR → Sessão → Faixa → Nível → Pagamento → Acompanhamento. No máximo 4 toques até pagar.

**Ecrãs**
1. **Sessão:**
   - Casa e DJ, e estado dos pedidos.
   - Faixa a tocar, com o Beat Pulse (B10.6).
   - CTA "Pedir música".
   - Acesso a "Agora na pista" e "Top da noite".
2. **Pesquisa:**
   - Foco automático e resultados instantâneos (debounce de 200 ms).
   - Secções "Encaixa no set", "Mais pedidas hoje" e "Recentes".
   - Cada linha mostra capa, título, artista, etiqueta de encaixe e "desde X €".
   - Faixas indisponíveis a cinzento, com o motivo.
3. **Nível:**
   - Faixa com preview de 30 s.
   - Três cartões, cada um com preço, ETA e a promessa numa linha.
   - Valor livre.
   - Garantia: "Se não tocar, devolvemos tudo".
   - CTA fixo com o total.
4. **Pagamento:**
   - Ordem dos métodos:
     - MB WAY primeiro se o dispositivo estiver em português;
     - Apple Pay ou Google Pay primeiro nos outros casos.
   - Telemóvel com indicativo, validado enquanto se escreve.
   - Contagem da validade da cotação.
   - Espera do MB WAY com contagem regressiva.
5. **Acompanhamento:**
   - Pago → Aceite → Na fila (posição e ETA) → A tocar → Tocou.
   - "Subir de nível".
   - Despromoções e reembolsos explicados com clareza, por exemplo "Passou para Na Fila · devolvemos 15 €".
6. **Tocou:**
   - Cartão partilhável em 1080×1920 e 1080×1080, gerado no servidor, com faixa, casa, hora e marca.
   - Partilha nativa.
7. **Agora na pista:** a faixa a tocar e os próximos pedidos, anónimos por defeito.
8. **Top da noite:**
   - Convidados com mais pedidos e faixas mais pedidas.
   - Participação por opt-in.
   - Valores ocultos por defeito (configurável).
9. **Os meus pedidos:** histórico, recibos e reembolsos.

**Identidade sem registo**
- **Sessão anónima, sem registo:** Supabase Anonymous Sign-ins. O `auth.uid()` anónimo é o dono dos pedidos, o que permite o RLS por convidado (B12.2).
- **Anti-bot invisível** (Cloudflare Turnstile) na criação da sessão e no início do pagamento.
- Validação:
  - no MB WAY, o pagamento valida o número;
  - no cartão, há email opcional para o recibo.
- @handle opcional, usado só no ranking e no Ecrã da Casa.
- SMS opcional, com consentimento, para "És o próximo" e reembolsos.

### B7. Cockpit do DJ (`/cockpit`, iPad landscape)

**Princípios**
- Leitura em menos de 1 s e alvos de toque de pelo menos 56 px.
- Feedback no instante do toque. Nada depende de hover.
- Segurança proporcional ao risco: recusar e cancelar têm "Desfazer" durante 5 s; só "Terminar set" exige manter premido.
- Wake Lock ativo.
- Funciona com ligação instável.

**Ecrã Ao Vivo**
- **Barra superior (64 px):**
  - sessão e interruptor grande para abrir ou pausar pedidos;
  - procura;
  - receita da sessão e "Recebes X €";
  - estado da ligação;
  - relógio e hora de fim.
- **Coluna esquerda (~35%), "Agora":**
  - faixa a tocar, com progresso, autor e valor;
  - slot "Próxima", com o botão principal "Marcar a tocar".
- **Coluna direita (~65%):**
  - **Decidir:** pedidos pagos à espera de decisão, ordenados por prazo, com contagem até ao reembolso automático.
  - **Alinhados:** pedidos aceites, agrupados `NEXT → SOON → QUEUE` e ordenados como em B5.5.
- **Barra inferior:** feed discreto de pagamentos e reembolsos.

**Cartão de pedido**
- **Faixa:**
  - Capa de 72 px.
  - Título e artista na fonte de UI, peso 700, 20 px, truncados. O nome completo aparece com um toque longo.
- **Metadados:** BPM, tonalidade Camelot, género e zona.
- **Chips:** nível, encaixe e biblioteca ("Na biblioteca" / "Fora da biblioteca").
- **Valor:** em grande, com "Recebes X €" por baixo.
- **Anel de prazo:** prazo de decisão em Decidir; prazo da promessa em Alinhados.
- **Mensagem do convidado** (se ativa), com opção de ocultar.
- **Ações em Decidir:**
  - **Aceitar.**
  - **Recusar:**
    - toque → motivo numa folha ancorada ao cartão (Fora do estilo / Não tenho a faixa / Já tocou / Outro);
    - o cartão recolhe e aparece "Desfazer" durante 5 s;
    - a recusa só é enviada ao servidor quando essa janela termina, e o reembolso segue automaticamente.
- **Ações em Alinhados:**
  - **Fixar como próxima.**
  - **Marcar a tocar.**
  - **Cancelar:** como Recusar (motivo e "Desfazer" durante 5 s). Reembolso total.

**Outros ecrãs**
- **Fila:** vista completa, com filtros (nível, género, BPM) e linha temporal dos prazos.
- **Sessão & Receita:**
  - receita por hora e aceitação;
  - reembolsos por motivo;
  - top faixas;
  - estado do payout;
  - exportação CSV e PDF.
- **Definições:**
  - Ritmo R, alterável ao vivo.
  - Preço base, ajustável em ±30% dentro dos limites da casa.
  - Catálogo, géneros, bloqueios e janela de não repetição.
  - Sons e importação da biblioteca.
  - Passar a sessão a outro DJ.
  - **Terminar set:** abre um resumo do que vai ser reembolsado (pedidos e valor) e confirma-se mantendo premido 2 s. Depois mostra o resumo do set.

**Fiabilidade**
- O servidor é a fonte de verdade. A UI é otimista, com rollback e aviso.
- Offline:
  - as ações ficam guardadas e sincronizam ao reconectar;
  - aviso "Sem ligação — ações guardadas".
- Os prazos só expiram no servidor.
- Proteção contra toque duplo (ignora repetições durante 400 ms, sem atrasar o primeiro toque) e chave de idempotência em cada ação.

### B8. Ecrã da Casa (`/display/[token]`)

- **Formato:** fullscreen, sem interação, em 16:9 e 9:16.
- **Conteúdo:**
  - faixa a tocar, com @handle se houver opt-in;
  - próximo pedido;
  - QR grande com "Pede a tua música";
  - top da noite.
- **Dados:** só públicos. O token assinado não dá acesso a mais nada.
- **Legibilidade:** alto contraste, legível a 15 m, crossfade de 800 ms.
- **QR:**
  - nunca anima;
  - mantém sempre a zona de silêncio;
  - nunca sai do ecrã, porque é o principal canal de aquisição.

### B9. Consola (`/console`)

**Painel da Casa**
- **Sessões:** data, horário, DJ, géneros, catálogo, preço base, ritmo, prazos, limites e split.
- **Zonas e QR:** QR por zona ou mesa, PDF para imprimir e link do Ecrã da Casa.
- **Preços:** limites por nível, recomendações por género (B5.4) e simulador (B5.9).
- **Equipa:** DJs e gestores, com papéis.
- **Receita:** GMV, líquido, comissões, payouts, faturas e reembolsos.
- **Análise:**
  - funil: scan → pesquisa → cotação → pagamento → tocou;
  - conversão por nível;
  - receita por hora e por género;
  - aceitação e reembolsos;
  - receita por convidado, com a lotação introduzida pela casa.

**Admin BetBeat**
- Casas e contratos (taxas, splits).
- Sessões ao vivo.
- Falhas de pagamento e de reembolso.
- Reconciliação.
- Feature flags.
- Auditoria.

### B10. Design System

**B10.1 Direção**
- Luxo noturno: preto quente, ouro e um único acento de calor.
- Premium e contido, sem neon nem gradientes gratuitos.
- O ouro marca só o que importa: ação principal, dinheiro e estado ativo.
- Fluidez ao nível Apple (skill `apple-design`): a interface responde no instante do toque, move-se com física e pode ser interrompida a qualquer momento.

**B10.2 Cores**

Os tokens vivem em `styles/tokens.css` e são expostos ao Tailwind.

**Fundos**

| Token | Valor | Uso |
|---|---|---|
| `bg-base` | #0A0806 | |
| `bg-raised` | #110E0B | |
| `surface-1` | #18140F | cartões |
| `surface-2` | #211B15 | elevado, ativo |
| `surface-3` | #2B241C | inputs, secundários |
| `line-subtle` | rgba(255,225,170,0.07) | |
| `line-strong` | rgba(255,225,170,0.14) | |

**Texto**

| Token | Valor | Uso |
|---|---|---|
| `text-primary` | #F6F0E6 | |
| `text-secondary` | #B9AE9C | |
| `text-tertiary` | #948A79 | só sobre bg, surface-1 e surface-2 |
| `text-on-accent` | #1A1206 | |

**Marca e estados**

| Token | Valor | Uso |
|---|---|---|
| `gold-500` | #F2C230 | ação principal, preços, ativo |
| `gold-300` | #F8DA7A | realce |
| `gold-700` | #B8901A | premido |
| `ember-500` | #FF5340 | ao vivo, urgência, destrutivo; texto por cima em `text-on-accent` |
| `amber-500` | #FFA31A | aviso, prazo a acabar |
| `green-500` | #3DD68C | confirmado, encaixa, ligado |

**Efeitos**
- `glow-gold`: `0 0 0 1px rgba(242,194,48,.45), 0 8px 32px rgba(242,194,48,.22)`.
- `glow-ember`: `0 0 24px rgba(255,83,64,.35)`.
- Gradiente de calor `#F2C230 → #FFA31A → #FF5340`, só em indicadores de procura e progresso.

**Regras**
- Interface só escura.
- Texto ≥ AA; preços e CTAs ≥ AAA.
- A cor nunca é o único sinal: os chips têm ícone e texto.

**B10.3 Tipografia**
- **Display — Unbounded** 600–800 (fonte da marca, via `next/font`).
  - Títulos de ecrã, números de destaque e Ecrã da Casa.
  - No Cockpit, só em títulos de secção.
- **UI — fonte do sistema** (`system-ui`: SF Pro em iPhone, iPad e Mac; Roboto em Android).
  - `font-optical-sizing: auto`.
  - Algarismos tabulares (`tabular-nums`) em preços, tempos e BPM.
  - Sem download de fonte para o texto de interface.
- **Editorial — Instrument Serif** (via `next/font`).
  - Só para valores monetários ≥ 28 px e frases de destaque, na app do convidado e no Ecrã da Casa.
  - Nunca no Cockpit.
- **Labels:** fonte de UI, peso 600, 12 px, maiúsculas, tracking +6%.
- **Tracking por tamanho, nunca um valor único:**
  - −2% a partir de 40 px;
  - −1% entre 24 e 32 px;
  - 0 no corpo de texto;
  - ligeiramente positivo no texto pequeno.
- **Escala:** 12 · 14 · 16 · 20 · 24 · 32 · 40 · 56 · 80 (o 80 só no Ecrã da Casa). Definida em `rem`, para respeitar o tamanho de texto do sistema; o layout acompanha.
- **Altura de linha:** inversa ao tamanho.
  - 1.05–1.2 nos títulos.
  - 1.5 no texto.
  - 1.3 na UI densa do Cockpit.
- **Hierarquia:** peso, tamanho e altura de linha em conjunto. A ênfase faz-se com peso.
- **Mínimos:** 14 px no Cockpit; 16 px nos inputs móveis (evita o zoom do iOS).

**B10.4 Layout, forma e materiais**
- **Grelha:** 4 pt (4 · 8 · 12 · 16 · 24 · 32 · 48 · 64).
- **Raios:** 8 para chips, 12 para botões e capas, 16 para cartões, 24 para folhas, e pílula.
- **Profundidade:**
  - Por luminosidade (bg → surface-1 → surface-2), não por sombras pesadas.
  - Só um glow por ecrã.
- **Materiais:**
  - **Material translúcido** nas barras fixas (topo e CTA inferior do convidado, barra superior do Cockpit) e nas folhas:
    - `bg-base` a ~72%;
    - `backdrop-filter: blur(20px) saturate(180%)`;
    - um filete superior subtil (`line-strong`);
    - o conteúdo passa por baixo.
  - **Transições:**
    - Onde o conteúdo encontra uma barra flutuante, usa um fade em máscara, não uma linha de 1 px.
    - Nunca sobrepor duas superfícies translúcidas.
  - **Tarefas modais** (pagamento, motivo de recusa, terminar set): o fundo escurece e recua ligeiramente. Painéis paralelos não usam scrim.
  - **Texto sobre material translúcido:** mais contraste e peso ligeiramente maior.
  - **Preferências do sistema:**
    - `prefers-reduced-transparency: reduce` → superfícies sólidas, sem blur.
    - `prefers-contrast: more` → sólidas e com contorno definido.
- **Telemóvel:** margens de 16 px, CTA fixo na safe area e uso a uma mão.
- **iPad:** 12 colunas, margens de 24 px e pelo menos 12 px entre ações opostas.
- **Ícones:** Lucide, traço 1.75, a 20 ou 24 px.

**B10.5 Componentes** (`components/ui`, todos no Storybook)
- **Lista:**
  - Button (primary, secondary, ghost, hold);
  - TierCard, TrackRow, TrackHero;
  - PriceTag (odómetro), FitChip, StatusStepper, CountdownRing;
  - RequestCard, NowPlaying, DemandMeter, LiveBadge;
  - Toast (com ação "Desfazer"), BottomSheet (arrastável), Skeleton, EmptyState;
  - QRBlock, ShareCard.
- **Estados obrigatórios:** normal, premido, desativado, a carregar e erro.

**B10.6 Motion e interação** (Motion, ex-Framer Motion; detalhe na skill `apple-design`)

**Princípio:** tudo o que se toca move-se com springs, tudo é interruptível e o movimento parte sempre do valor atual no ecrã.

**Springs** (`type: "spring"`, com `bounce` e `duration`)

| Token | bounce | duration | Uso |
|---|---|---|---|
| `spring-default` | 0 | 0.35 s | a maioria das transições de UI |
| `spring-move` | 0 | 0.4 s | reposicionar (reordenar, "Fixar como próxima") |
| `spring-sheet` | 0.2 | 0.3 s | folhas e gavetas |
| `spring-momentum` | 0.2 | 0.4 s | só depois de um gesto com momento (flick, largar após arrastar) |

- Bounce só quando o gesto trouxe momento. Nunca em elementos que apenas aparecem.

**Tweens** (só opacidade e cor, nunca em gestos)
- **Durações:** `instant` 100 ms, `fast` 180 ms, `base` 280 ms e `slow` 480 ms; `ambient` 1600 ms para indicadores ao vivo.
- **Easing `standard`:** cubic-bezier(0.2, 0, 0, 1).
- **Transições reversíveis:** curvas espelhadas na ida e na volta.

**Checklist de interação** (obrigatória em todos os ecrãs)
1. **Resposta imediata.**
   - Feedback no pointer-down (scale 0.97, 100 ms); a ação confirma-se no pointer-up.
   - ~10 px de tolerância à volta dos alvos; arrastar para fora cancela.
2. **Zero latência artificial.** Sem esperas de transição nem atraso de toque. Os debounces só impedem ações duplicadas; nunca atrasam o feedback.
3. **Interrupção.** Qualquer animação pode ser agarrada ou invertida a meio, sem bloquear input.
4. **Gestos 1:1.**
   - Folhas e "manter premido" seguem o dedo, respeitando o ponto onde se agarrou (Pointer Events com pointer capture).
   - Nada controlado por gestos usa CSS transitions ou keyframes.
5. **Largar com física.**
   - A animação continua à velocidade do dedo.
   - O destino escolhe-se pela projeção do momento (desaceleração 0.998).
   - Abrir ou fechar decide-se pelo sentido da velocidade, não só pela posição.
6. **Limites suaves.** Rubber-banding, nunca paragem seca.
7. **Coerência espacial.**
   - Entra e sai pelo mesmo caminho.
   - Menus e folhas nascem do elemento que os abriu (`transform-origin`).
   - O que se desfaz volta por onde saiu.
8. **Desempenho.** Só se animam `transform` e `opacity`, com `will-change` quando o movimento é iminente.
9. **Contenção.**
   - O movimento explica mudanças de estado.
   - Nada em loop, exceto os indicadores ao vivo.
   - Nada acima de 600 ms no caminho crítico.

**Reduced motion** (`prefers-reduced-motion`)
- Cross-fades curtos (120 ms) em vez de slides, springs com bounce e parallax.
- O Beat Pulse fica estático.
- Mantêm-se as mudanças de opacidade e cor que ajudam a compreender.

**Assinatura — Beat Pulse**
- Anel concêntrico que pulsa ao BPM do set (período de 60/BPM s).
- Aparece no indicador ao vivo, em "A tocar" e na confirmação de pagamento.

**Animações**
1. **Escolher nível:** o cartão sobe (scale 1.02, `spring-default`), o contorno dourado desenha-se (`fast`) e entra o glow.
2. **Preço muda:** os dígitos rolam como um odómetro (`slow`), sem cores de subida ou descida.
3. **Espera MB WAY:** anel de contagem regressiva e ícone de telemóvel com pulso suave.
4. **Pagamento confirmado:** no mesmo frame, o check desenha-se (`base`), três anéis do Beat Pulse expandem-se (600 ms) e há uma vibração curta onde for suportada.
5. **Progresso do pedido:** preenchimento contínuo entre etapas (`slow`).
6. **Folhas** (pagamento, subir de nível, motivo de recusa): `spring-sheet`. Arrastam-se para fechar, com momento e rubber-banding, e o fundo escurece e recua.
7. **Novo pedido no Cockpit:** o cartão entra de cima (`spring-default`), com 2 pulsos de glow dourado e um som curto.
8. **Listas:** reordenação com animação de layout (`spring-move`), sem saltos.
9. **Anel de prazo:**
   - Ouro → âmbar (< 2 min) → brasa (< 60 s).
   - Pulso suave nos últimos 10 s.
   - Nunca treme.
10. **Recusar ou cancelar:** o cartão recolhe (`spring-default`) e aparece o toast com "Desfazer". Se o DJ desfizer, o cartão volta pelo mesmo caminho.
11. **Manter premido** (Terminar set): o preenchimento em brasa acompanha o dedo e recua com spring se o largar.
12. **Fixar como próxima:** o cartão viaja para o slot "Próxima" com transição partilhada (`spring-move`).
13. **Ecrã da Casa:** crossfade de 800 ms. O QR nunca anima.
14. **Carregamento:** skeletons com shimmer de 1.4 s. Nunca spinners de ecrã inteiro.

**B10.7 Som e háptica**
- **Alertas no Cockpit:**
  - curtos (< 400 ms), audíveis por cima de música alta, com um tom diferente por nível;
  - volume ajustável;
  - modo silencioso com um flash dourado na borda do ecrã.
- **Causalidade:** o feedback dispara no evento que o causa.
- **Harmonia:** som, vibração e animação no mesmo frame.
- **Utilidade:** só em momentos com significado (novo pedido, pagamento confirmado, aceite, erro).

**B10.8 Voz e orientação**
- **Estilo:** pt-PT, por "tu", frases curtas e confiantes.
- **Exemplos de tom:**
  - "Pedir música"
  - "Escolhe quanto queres esperar"
  - "Se não tocar, devolvemos tudo"
  - "Confirma na app MB WAY"
  - "O DJ aceitou. Toca dentro de ~6 min"
  - "Devolvemos 12 €. Já vai a caminho."
- **Erros:** cada erro diz o que aconteceu e o que fazer a seguir.
- **Validação inline:** enquanto se escreve, nunca só ao submeter.
- **Orientação:** cada ecrã deixa claro onde estou, o que posso fazer e como volto atrás.
- **Rótulos específicos** ("Pedir música", "Os meus pedidos"), nunca genéricos.

### B11. Arquitetura técnica

**Stack**
- **App:**
  - Next.js (App Router);
  - TypeScript `strict`;
  - Tailwind, com tokens em variáveis CSS;
  - Motion (ex-Framer Motion);
  - Vaul ou equivalente para folhas arrastáveis.
- **Fontes:** `next/font` só para Unbounded e Instrument Serif. O texto de UI usa a fonte do sistema.
- **Supabase:**
  - Postgres, Realtime e RLS por casa;
  - Auth: anónimo para convidados; staff com email, e MFA para gestores e admin;
  - em local, via Supabase CLI.
- **Worker Node com pg-boss**, para:
  - prazos ao segundo;
  - reembolsos e payouts;
  - reconciliação;
  - o job semanal de preços.
- **Validação:** zod.
- **Segurança:** Cloudflare Turnstile (anti-bot) e gitleaks (segredos).
- **Testes:**
  - Vitest + fast-check;
  - Playwright + axe (acessibilidade);
  - Storybook.
- **i18n:** next-intl ou equivalente.
- **PWA:**
  - manifest próprio para convidado e cockpit;
  - service worker no Cockpit para o modo offline.
- **Observabilidade:** Sentry e PostHog, ligados na Fase 8.
- **Gestor de pacotes:** pnpm.

**Pastas**
```
app/(guest)/s/[qrToken]/
app/(cockpit)/cockpit/
app/(display)/display/[token]/
app/(console)/console/
app/api/                     # route handlers e webhooks
lib/pricing/   lib/domain/   lib/payments/   lib/ledger/
lib/invoicing/ lib/notifications/ lib/catalog/ lib/realtime/
lib/security/                # env, rate limit, headers, cifra
components/ui/
styles/tokens.css
messages/pt-PT.json  messages/en.json
worker/
supabase/migrations/  supabase/seed.sql
scripts/
tests/e2e/
docs/
```

**Dados**
- **Tabelas:**
  - organização: venues, zones, staff, sessions, session_settings;
  - catálogo: library_tracks, tracks (cache do catálogo);
  - pedidos: guests, quotes, requests, request_events;
  - dinheiro: payments, refunds, ledger_entries, payouts, invoices;
  - preços: genre_multipliers;
  - auditoria: audit_log.
- **Dinheiro:** sempre em cêntimos (inteiros).
- **Datas:** em UTC, apresentadas em Europe/Lisbon.
- **Papéis:** guest, dj, manager, admin.
- **RLS:** em todas as tabelas (B12.2).

**Tempo real**
- **Eventos:**
  - `request.paid`, `request.accepted`, `request.rejected`, `request.pinned`;
  - `request.playing`, `request.played`, `request.refunded`, `request.sla_missed`;
  - `queue.changed`, `price.changed`;
  - `session.paused`, `session.ended`.
- **Entrega:** o servidor publica eventos já filtrados por Realtime Broadcast. Os clientes nunca subscrevem alterações diretas das tabelas.
- **Canais:**
  - um canal privado de staff por sessão;
  - um canal privado por convidado;
  - um canal público só com dados públicos (Ecrã da Casa e "Agora na pista").
  - Os canais privados são autorizados por RLS.

**Requisitos não funcionais**
- **Desempenho:**
  - Pagamento confirmado → alerta no Cockpit em < 1 s (p95).
  - Cotação em < 150 ms (p95).
  - LCP do convidado < 2 s em 4G.
- **Carga:** 1 000 convidados e 50 pedidos/min por sessão.
- **Segurança:** B12.
- **Acessibilidade:** AA, reduced motion, reduced transparency e teclado na Consola.
- **Tempo:** `now` injetável em todo o domínio, para testar prazos sem esperar.

**Scripts**
- Básicos: `dev`, `worker`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `storybook`.
- `db:reset`: migrações + seed.
- `db:audit`: auditoria de RLS e policies (B12.7).
- `simulate`: convidados simulados a fazer pedidos em tempo real, para demos e para testar o Cockpit.

### B12. Segurança

É obrigatória em todas as fases. O `pnpm db:audit` e a revisão desta lista fazem parte dos critérios de conclusão (Parte C).

**B12.1 Segredos e chaves**
- **Nada no código:** todas as chaves vêm de variáveis de ambiente, validadas no arranque com zod (`lib/security/env.ts`). A app não arranca se faltar alguma.
- **Nada no git:**
  - `.env*` no `.gitignore` (exceto `.env.example`);
  - gitleaks no pre-commit e no CI.
  - Se um segredo chegar a ser commitado, a chave é rodada de imediato e o histórico é limpo.
- **Chave secreta do Supabase** (`service_role` / secret): só no servidor (route handlers, server actions e worker).
  - Nunca em código cliente nem em variáveis `NEXT_PUBLIC_*`.
  - Os módulos que a usam importam `server-only`.
- **No cliente, só a chave pública** (anon / publishable). Não dá acesso a nada além do que o RLS permite, e há testes que o provam (B12.2).

**B12.2 Base de dados e acesso**
- **RLS ativo em todas as tabelas,** sem exceção. Por defeito, tudo negado.
- **Policies sempre escopadas:**
  - por dono (`auth.uid() = guest_id` ou equivalente);
  - por casa, através dos papéis do utilizador nessa casa.
  - Proibido `USING (true)` ou `WITH CHECK (true)` genérico.
  - Os convidados anónimos também têm o papel `authenticated`: as policies de staff verificam o papel na casa, nunca apenas `authenticated`.
- **Dinheiro e auditoria** (payments, refunds, ledger_entries, payouts, invoices, audit_log): nenhum cliente escreve; só o servidor.
- **Menor privilégio por papel** (guest, dj, manager, admin): cada policy e cada rota dá só o que a função precisa. Por exemplo, o DJ vê os pedidos da sua sessão, não as finanças da casa.
- **Sem mass assignment:** cada rota valida o corpo com um schema zod estrito (allowlist de campos). Preço, estado, papel, `venue_id` e valores nunca vêm do cliente.
- **Sem SQL concatenado:** queries parametrizadas pelo cliente Supabase ou por RPC, também dentro das funções Postgres.
- **Validação zod** em todas as entradas externas: rotas, server actions, webhooks e jobs.
- **Testes de acesso:** com a chave pública e com cada papel, tenta-se ler e escrever cada tabela. Tudo o que estiver fora do escopo tem de falhar.

**B12.3 Autenticação e sessão**
- **Sem ecrãs sensíveis abertos:**
  - Cockpit e Consola exigem sessão de staff.
  - O convidado só vê os seus próprios dados.
  - O Ecrã da Casa mostra só dados públicos.
- **Validação no servidor:** a sessão é validada no servidor em cada pedido (middleware e rotas). O cliente nunca decide permissões.
- **Cookies:** `httpOnly`, `secure` e `sameSite`. Se a biblioteca de auth exigir uma exceção, fica documentada em `docs/DECISIONS.md`, com a respetiva mitigação.
- **Palavras-passe:** só no Supabase Auth, com hash. A app nunca as guarda.
- **MFA:** obrigatório para gestores e admin.

**B12.4 Infraestrutura e tráfego**
- **HTTPS** em todas as rotas, com HSTS.
- **Security headers** em todas as respostas:
  - CSP estrita, com nonce;
  - `frame-ancestors 'none'` / `X-Frame-Options: DENY`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy` mínima.
- **Rate limiting** nos endpoints públicos sensíveis, com os limites de B4.7: sessão anónima, pesquisa, cotações, pagamentos, login e qualquer rota de IA futura.
- **Anti-bot** (Turnstile): na sessão anónima, no início do pagamento e no login do staff.
- **Uploads** (biblioteca rekordbox/CSV, imagens da casa):
  - tipo real verificado pelo conteúdo;
  - tamanho máximo de 10 MB para bibliotecas e 2 MB para imagens;
  - parser de XML sem entidades externas.
- **Respostas mínimas:**
  - cada rota devolve só os campos de que o ecrã precisa (DTOs explícitos, nunca `select *` para o cliente);
  - nenhum convidado recebe telemóveis, emails ou dados de outros.
- **Sem fugas:**
  - o cliente recebe erros genéricos, com um id de correlação;
  - stack traces, chaves e dados pessoais nunca aparecem em respostas nem em logs;
  - telemóveis mascarados nos logs;
  - Sentry com limpeza de dados.

**B12.5 Dados sensíveis**
- **Encriptação em repouso** (AES-256-GCM com a chave fora da base de dados, ou Supabase Vault) para tokens de terceiros, dados de payout (IBAN) e telemóveis dos convidados.
- **Limites e anti-abuso:** usa-se um hash com sal do telemóvel, nunca o número em claro.

**B12.6 Dependências**
- **Antes de instalar:** confirmar o nome exato, o editor, os downloads e o repositório, para evitar typosquatting.
- **Lockfile** commitado.
- **Scripts de instalação** de dependências bloqueados por defeito; só correm os aprovados.
- **`pnpm audit`** no CI, sem vulnerabilidades altas.

**B12.7 Auditoria antes de entregar**
- **`pnpm db:audit`:** consulta o catálogo do Postgres e falha se:
  - alguma tabela de `public` não tiver RLS;
  - alguma policy for `true` genérico;
  - `anon` ou `authenticated` tiverem privilégios além do previsto.
- **Quando corre:** no CI e no fim das Fases 1, 3, 7, 8 e 9.

### B13. Legal

- **Natureza do serviço:**
  - Compra de um serviço com resultado determinístico e reembolso garantido. Não é jogo.
  - A validar com advogado antes do lançamento, incluindo o nome da marca.
- **Música:**
  - O BetBeat não reproduz áudio na sala; o DJ toca a música ao abrigo das licenças da casa.
  - As previews seguem os termos da API de catálogo.
- **RGPD:**
  - dados mínimos;
  - consentimento explícito para SMS e ranking;
  - retenção definida;
  - acordo de tratamento de dados com cada casa.
- **Transparência:**
  - Preço final com IVA visível antes de pagar.
  - Termos e política de reembolso acessíveis no checkout.

### B14. Métricas

- **North Star:** receita por convidado por noite.
- **Convidado:**
  - tempo do QR ao pagamento (mediana < 30 s);
  - conversão de cotação em pagamento;
  - % de convidados que pedem.
- **DJ:**
  - aceitação > 85%;
  - tempo de decisão;
  - prazos cumpridos > 95%.
- **Saúde:**
  - reembolsos < 10%;
  - falhas de pagamento;
  - latência.
- **Instrumentação:** funil instrumentado desde o primeiro dia, com nomes de eventos estáveis.

---

## PARTE C — FASES E CRITÉRIOS DE CONCLUSÃO

Cada fase termina com:
- verificações verdes;
- screenshots revistos, se houver UI;
- `docs/PROGRESS.md` atualizado;
- commit;
- paragem para aprovação.

### Fase 0 — Plano (sem ficheiros)

- **Leitura:** lê o brief todo.
- **Ambiente:**
  - Verifica o Node (20 ou superior), o pnpm e o Docker (para o Supabase local).
  - Se não houver Docker, pede-me as credenciais de um projeto Supabase de desenvolvimento.
  - Confirma que a skill `apple-design` (`SKILL.md`) está na raiz.
- **Entrega:**
  - plano de arquitetura numa página;
  - modelo de dados resumido;
  - riscos principais;
  - no máximo 5 perguntas críticas.

### Fase 1 — Fundações

**Âmbito**
- **Estrutura base:** Next.js, TS strict, Tailwind, ESLint, Prettier, Vitest, Playwright e Storybook.
- **Git:** hook de pre-commit com lint, typecheck e gitleaks.
- **Ficheiros de A3**, incluindo a skill em `.claude/skills/apple-design/`.
- **Design system base:** tokens de cor, tipografia e motion (springs e tweens), fontes e componentes base.
- **Segurança de base:** `env.ts`, security headers, RLS negado por defeito e `pnpm db:audit`.
- **Base de dados:** Supabase local, com migrações e RLS.
- **Seed fictício:**
  - 1 casa, 3 zonas e 2 DJs;
  - 1 sessão ativa;
  - cerca de 200 faixas de vários géneros, com BPM e tonalidade.

**Concluído quando**
- `pnpm db:reset` e `pnpm dev` funcionam de raiz.
- O Storybook mostra os componentes base em todos os estados.
- A página de tokens foi revista em screenshot.
- `pnpm db:audit` passa e o gitleaks não encontra segredos.
- A skill está em `.claude/skills/apple-design/SKILL.md`.

### Fase 2 — Motor de preço

**Âmbito**
- `lib/pricing`.
- Testes de B5.8.
- Simulador.

**Concluído quando**
- Todos os testes passam, incluindo o exemplo de B5.2.
- O simulador funciona.
- A revisão do subagente está resolvida.

### Fase 3 — Domínio e dinheiro

**Âmbito**
- Máquina de estados e serviço de cotações.
- Reserva de lugares.
- `MockPaymentProvider` e painel de simulação.
- Ledger e reembolsos.
- Worker: prazos, timeouts e fecho automático.
- Eventos em tempo real (Broadcast em canais autorizados).

**Concluído quando**
- Os testes de integração cobrem todas as transições e motivos, incluindo:
  - prazo falhado → despromoção e devolução da diferença;
  - cotações expiradas recusadas.
- Os reembolsos acontecem exatamente uma vez, mesmo com webhooks duplicados.
- Um teste de concorrência prova que o mesmo `NEXT` nunca é vendido duas vezes.
- O ledger bate certo em todos os cenários.
- Os testes de acesso de B12.2 passam para todas as tabelas e papéis, e o `pnpm db:audit` passa.
- A revisão do subagente está resolvida.

### Fase 4 — App do Convidado

**Âmbito**
- B6 completo, em PT e EN.
- Sessão anónima e Turnstile.
- Tempo real.
- Cartão partilhável.

**Concluído quando**
- Os testes E2E cobrem:
  - pedir → pagar → acompanhar → tocou → partilhar;
  - o caminho do reembolso.
- Os screenshots a 393×852 foram revistos.
- A checklist de interação de B10.6 foi verificada ecrã a ecrã, incluindo reduced motion, reduced transparency e contraste aumentado.
- O axe não encontra erros graves.
- Bastam 4 toques ou menos do QR ao pagamento.

### Fase 5 — Cockpit do DJ

**Âmbito**
- B7 completo.
- Sons.
- "Desfazer" e "manter premido".
- Modo offline.
- Wake Lock.

**Concluído quando**
- Os testes E2E cobrem aceitar, recusar (com e sem "Desfazer"), fixar, marcar a tocar, cancelar e terminar set.
- Com `pnpm simulate` a correr, os pedidos aparecem em menos de 1 s.
- Os screenshots a 1194×834 foram revistos.
- A checklist de interação de B10.6 foi verificada.

### Fase 6 — Ecrã da Casa

**Âmbito**
- B8 completo.

**Concluído quando**
- Os screenshots a 1920×1080 e 1080×1920 foram revistos.
- O QR é descodificado com sucesso a partir do screenshot.

### Fase 7 — Consola

**Âmbito**
- B9 completo.
- Job semanal de `M_g`.
- PDF de QR codes.

**Concluído quando**
- Um teste E2E cobre: criar sessão → gerar QR → sessão ao vivo → fechar → ver receita e payout.
- A checklist de interação de B10.6 foi verificada.
- O `pnpm db:audit` passa.

### Fase 8 — Integrações reais e robustez

**Âmbito**
- Adaptadores reais (PSP, faturação, SMS e catálogo), com as credenciais que eu fornecer.
- Sentry e PostHog.
- Teste de carga com as metas de B11.
- Revisão de segurança completa contra B12, com os headers verificados por teste automático.

**Concluído quando**
- Os pagamentos foram validados na sandbox do PSP.
- Os resultados do teste de carga estão documentados.
- O `pnpm db:audit`, o gitleaks e o `pnpm audit` estão limpos.
- A revisão do subagente está resolvida.

### Fase 9 — Entrega

- **README:**
  - setup e variáveis;
  - arquitetura;
  - motor de preço explicado com exemplos.
- **Guia de operação de uma noite:**
  - abrir a sessão;
  - lidar com falhas;
  - fazer reembolsos manuais;
  - fechar.
- **`docs/SECURITY.md`:** como cada ponto de B12 é cumprido, com o resultado do último `pnpm db:audit`.
- **Versões finais** de `docs/DECISIONS.md` e `docs/PROGRESS.md`.
