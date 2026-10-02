# Guia de operação de uma noite

Para quem abre a casa, acompanha o set e fecha a noite: gestores, DJs e a equipa
BetBeat. Linguagem de produto (B3): "Na Fila" = `QUEUE`, "Em Breve" = `SOON`,
"A Seguir" = `NEXT`.

Regras que nunca mudam (B1): o DJ tem a última palavra; se não tocar, o
convidado não paga; o preço, o tempo estimado e as regras são visíveis antes de
pagar; as transições de estado e os reembolsos acontecem só no servidor.

## 1. Antes de abrir

**Infraestrutura (equipa BetBeat)**

1. App (`pnpm start` ou o deploy), Supabase e o worker (`pnpm worker`) a correr.
   Sem worker não há prazos, reembolsos automáticos, payouts nem fecho
   automático de sessões. O worker escreve uma tabela de jobs no arranque;
   confirma que `deadline loop` está ativo.
2. Variáveis de ambiente validadas no arranque (a app não arranca se faltar
   alguma). `PAYMENT_PROVIDER=mock` só em demo; em produção o adaptador real.
3. `pnpm db:audit` limpo depois de qualquer migração.

**Casa (Consola, gestor)**

1. **Sessões → Nova sessão.** Data, horário (hora de fim realista: a sessão fecha
   sozinha 30 min depois), DJ, géneros do set, catálogo (só biblioteca ou
   biblioteca + catálogo), preço base `B`, ritmo `R` (pedidos que o DJ aceita
   tocar por hora), prazos (`SOON` 20 min, `NEXT` 10 min), janelas de decisão
   (3 / 5 / 10 min), limites por nível e split casa/DJ. A Consola rejeita
   limites que tornem impossível a ordem garantida (cada nível ≥ 5 € acima do
   anterior).
2. **Zonas e QR.** Um QR por zona ou mesa (Zonas → Imprimir). Os QR são
   assinados: não precisam de ser reimpressos entre sessões, apontam sempre para
   a sessão ao vivo da casa. Confirma o link do Ecrã da Casa na TV.
3. **Equipa.** O DJ da noite tem conta e papel `dj` nesta casa; gestores e admin
   usam MFA (código TOTP) em cada sessão.
4. **Preços.** Revê as recomendações por género (job semanal) e aprova, ajusta ou
   deixa em automático.

**DJ (Cockpit, iPad em landscape)**

1. Entra em `/cockpit`; o cockpit liga-se sozinho à sessão ao vivo da casa.
2. Instala como app (partilhar → ecrã principal) para ter ecrã inteiro, Wake
   Lock e o modo offline.
3. Definições: ritmo `R`, preço base (±30 % dentro dos limites da casa), géneros
   bloqueados, janela de não repetição, som (volume ou modo silencioso com
   flash dourado) e importação da biblioteca (rekordbox XML ou CSV, máx. 10 MB).
4. Testa o som ("Testar som") com a música da sala a tocar.
5. Interruptor "Pedidos abertos" ligado. Até lá os convidados veem "Os pedidos
   estão em pausa".

## 2. Durante o set

**O que o DJ faz**

- **Decidir:** cada pedido pago aparece em menos de 1 s com som e brilho dourado.
  Aceitar ou Recusar (motivo numa folha: Fora do estilo / Não tenho a faixa / Já
  tocou / Outro). Recusar tem "Desfazer" durante 5 s; só depois é enviado e o
  reembolso segue sozinho. Sem decisão dentro da janela, o pedido é reembolsado
  automaticamente (o anel mostra o prazo: ouro → âmbar → brasa).
- **Alinhados:** pedidos aceites por `NEXT → SOON → QUEUE`. "Fixar como próxima"
  leva o pedido ao slot "Próxima"; "Marcar a tocar" quando a faixa entra. Marcar
  a próxima fecha a anterior como "Tocou". Cancelar reembolsa na totalidade,
  também com "Desfazer".
- **Prazo falhado:** se um `SOON` ou `NEXT` não tocar a tempo, o servidor passa-o
  a `QUEUE` e devolve a diferença ao convidado. O pedido continua na fila; o DJ
  vê "Prazo falhado" no feed. Nada a fazer, mas o ritmo `R` pode estar alto
  demais para o set: baixa-o nas Definições.
- **Pausar pedidos:** interruptor no topo. Os pedidos já pagos continuam a
  contar prazos; só bloqueia novos pedidos.
- **Procura instável:** o cockpit mostra "Sem ligação - ações guardadas"; as
  ações ficam em fila e sincronizam ao religar. O estado que conta é o do
  servidor: ao reconectar o cockpit reconcilia.

**O que o gestor acompanha (Consola)**

- Sessões ao vivo: receita, aceitação, reembolsos por motivo.
- Análise: funil scan → pesquisa → cotação → pagamento → tocou. Uma quebra entre
  cotação e pagamento costuma ser preço (vê a procura) ou um problema de
  pagamento (vê Falhas).

## 3. Lidar com falhas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Convidado pagou e o cockpit não mostra o pedido | Realtime do cockpit caiu | O cockpit refaz o estado ao religar (indicador no topo). Recarregar a página do cockpit nunca perde pedidos: o servidor é a fonte de verdade. |
| "Pagamento confirmado" demora | Webhook do PSP atrasado | O pedido fica `pending_payment` até ao webhook ou ao timeout MB WAY (4 min). Expirado: nada é cobrado. Em demo, o painel DEV simula o PSP. |
| Reembolso falhado (Consola → Admin → Falhas) | PSP recusou ou rede | O worker repete com backoff (5 tentativas) e alerta o admin. Depois disso, reembolso manual (secção 4). |
| Prazos não expiram, pedidos ficam em Decidir para lá da janela | Worker parado | Arranca o worker (`pnpm worker`). Ele recupera tudo o que ficou por processar: prazos, pagamentos expirados, sessões por fechar. |
| QR "já não é válido" | Token de outra casa/zona, ou `QR_TOKEN_SECRET` mudou | Reimprime os QR a partir da Consola. Se o segredo mudou, todos os QR antigos deixam de funcionar: é esperado. |
| Convidado não consegue pedir ("Já tens 3 pedidos ativos", limite de gasto) | Limites por convidado (B4.7) | É proteção, não falha. Espera que um pedido toque ou seja reembolsado. |
| DJ sem acesso ao cockpit | Conta sem papel `dj` nesta casa | Equipa → convida o DJ para a casa com o papel certo. |
| Gestor sem código MFA | Perdeu a app de autenticação | Admin BetBeat remove o fator no Supabase Auth; no próximo login o gestor volta a inscrever. |
| Cockpit em branco sem rede | Primeira abertura sem cache | O service worker guarda o cockpit depois da primeira visita com rede. Abre-o uma vez com ligação antes do set. |

Em qualquer falha de dinheiro, a auditoria (Consola → Admin → Auditoria) e os
`request_events` mostram cada transição com ator e hora.

## 4. Reembolsos manuais

Os reembolsos são automáticos em todos os casos do brief (B4.4). Só são manuais
quando o automático falhou de vez (5 tentativas) ou quando a casa decide
devolver por cortesia.

1. Consola → Admin → **Falhas**: encontra o reembolso `failed`. "Tentar de novo"
   volta a pô-lo na fila do worker com a mesma chave de idempotência (nunca
   duplica).
2. Se o PSP continua a recusar, faz o reembolso no painel do PSP e marca-o como
   resolvido na Consola com a referência do PSP. O ledger regista o lançamento
   com o ator e a referência; o saldo do convidado volta a bater certo na
   reconciliação diária.
3. Cortesia (o pedido tocou mas a casa quer devolver): só o admin, pela Consola,
   com motivo registado. A taxa BetBeat e o split são revertidos no mesmo grupo
   de lançamentos.
4. Avisa o convidado: ele vê o reembolso em "Os meus pedidos"; se deu telemóvel
   ou email, recebe SMS ou email ("Devolvemos 12 €. Já vai a caminho.").

Nunca edites `payments`, `refunds` ou `ledger_entries` à mão: as tabelas de
dinheiro são imutáveis e só o servidor escreve nelas.

## 5. Fechar a noite

**DJ:** Definições → **Terminar set**. A folha mostra quantos pedidos por tocar
vão ser reembolsados e o valor; confirma-se mantendo premido 2 s. Depois aparece
o resumo do set (receita bruta, reembolsos, "Recebes X €", casa, aceitação, top
faixas). Se o DJ não terminar, a sessão fecha sozinha 30 min depois da hora de
fim com os mesmos reembolsos.

**Gestor:** Consola → Receita → sessão: GMV, líquido, comissão BetBeat,
reembolsos, faturas e o estado do payout (casa e DJ). Os payouts ficam
pendentes no fecho e são executados pelo worker (SEPA via PSP a partir da Fase
8; mock até lá), com relatório. Exporta CSV ou PDF se a contabilidade pedir.

**Equipa BetBeat:** reconciliação diária às 05:00 (worker) compara PSP, ledger e
pedidos; diferenças aparecem em Admin → Reconciliação. Trata-as antes de
qualquer payout.

## 6. Demo e ensaio

- `pnpm simulate --rate 12 --minutes 5` enche o cockpit com convidados fictícios
  a pagar por MB WAY (confirmados pelo painel DEV, pelo caminho real dos
  webhooks). Mostra no fim a latência confirmação → webhook.
- O painel "DEV" na app do convidado simula MB WAY confirmado, recusado,
  expirado, webhook duplicado e falha de rede. Só existe fora de produção.
- `pnpm db:reset` devolve a base de dados ao estado inicial (uma casa, três
  zonas, dois DJs, uma sessão ao vivo, ~200 faixas fictícias).
