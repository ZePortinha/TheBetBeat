# Discontrol nas lojas (App Store e Google Play) com Capacitor

Guia das fases até a app estar publicada. Escrito em português porque é um
guia de passos para o Vouga, não código (ver DECISIONS 2026-11-11).

## Como a app está montada

A app nativa é uma "casca" Capacitor (iOS em `ios/`, Android em `android/`)
que abre o site Discontrol em produção dentro da WebView do telemóvel
(`server.url` em `capacitor.config.ts`).

Porque não um export estático para dentro da app: o Discontrol renderiza no
servidor. O middleware gera um nonce de CSP por pedido, a sessão Supabase vive
em cookies httpOnly, há server actions, rotas `/api` e webhooks MB WAY. Nada
disso existe num `next export`. Carregar o site remoto mantém um só código,
as mesmas regras de segurança, e cada deploy do site chega à app sem nova
revisão das lojas.

O que a casca acrescenta ao site:

| Peça | Onde |
| --- | --- |
| Ícone e ecrã de arranque (preto + marca Discontrol) | `native/assets/` (fontes), gerados em `ios/` e `android/` |
| Página "Sem ligação" quando não há rede | `native/www/offline.html` |
| Notificações nativas (ultrapassaram-te / ganhaste) via APNs e FCM | `lib/notifications/native-push.ts`, `app/api/guest/push/native`, migração 0022 |
| QR lido com a câmara do telemóvel abre a app (links universais / App Links) | `app/.well-known/*`, `ios/App/App/App.entitlements`, `AndroidManifest.xml` |
| Botão "voltar" do Android, barra de estado, esconder o arranque | `components/native/native-bridge.tsx` |

No browser nada muda: o código nativo só é carregado quando a página corre
dentro da app.

## Comandos

```bash
pnpm install
pnpm cap:sync                 # produção: abre https://discontrol.app
pnpm cap:android              # sync + abre o Android Studio
pnpm cap:ios                  # sync + abre o Xcode (só num Mac)

# Testar no telemóvel contra o PC, na mesma rede Wi-Fi:
CAP_SERVER_URL=http://192.168.1.71:3000 pnpm cap:android
```

No teste em rede local, o `NEXT_PUBLIC_SUPABASE_URL` do `.env.local` também
tem de apontar para o IP do PC (não `localhost`), senão o telemóvel não chega
ao Supabase. Uma build feita com `http://` nunca vai para as lojas
(`cap:sync` avisa).

Para regenerar ícones e arranque depois de mudar a marca:
`npx @capacitor/assets@3.0.5 generate --assetPath native/assets`.

## Fase 0: casca da app (feito neste PR)

Capacitor 8, projetos iOS e Android, ícone, arranque, página offline, push
nativo e links universais preparados. Tudo desligado até haver chaves.

## Fase 1: contas (só o Vouga pode fazer)

1. **Apple Developer Program**: 99 €/ano (99 USD).
   [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/).
   Sem empresa, a conta é individual e o nome que aparece na App Store como
   vendedor é o teu nome pessoal. Uma conta de organização mostra
   "Discontrol" mas exige empresa e número D-U-N-S (gratuito, demora dias).
   Precisa de Apple ID com autenticação de dois fatores.
2. **Google Play Console**: 25 USD, pagamento único.
   [play.google.com/console/signup](https://play.google.com/console/signup).
   Verificação de identidade com documento. Atenção: contas **pessoais**
   novas têm de fazer um teste fechado com **pelo menos 12 testers durante
   14 dias seguidos** antes de poderem publicar em produção. Convém juntar
   12 amigos com Android logo no início.
3. **Firebase** (grátis): criar projeto "Discontrol" em
   [console.firebase.google.com](https://console.firebase.google.com),
   adicionar uma app Android com o pacote `app.discontrol`.

O id `app.discontrol` fica fixo para sempre depois do primeiro envio a
qualquer loja. Se quiseres outro, diz antes.

## Fase 2: site em produção

A app abre `https://discontrol.app` (ou o domínio que escolheres, em
`CAP_SERVER_URL` e no `capacitor.config.ts`). Hoje o site corre no teu PC,
por isso antes de qualquer revisão é preciso:

- domínio comprado e site publicado com HTTPS (Vercel ou similar) + Supabase
  na cloud + worker a correr;
- se o domínio não for `discontrol.app`, trocar também
  `applinks:discontrol.app` em `ios/App/App/App.entitlements` e o
  `android:host` em `android/app/src/main/AndroidManifest.xml`.

## Fase 3: chaves (só o Vouga, depois da Fase 1)

| Chave | Onde se tira | Onde vai |
| --- | --- | --- |
| Team ID (10 letras) | developer.apple.com > Membership | `APPLE_TEAM_ID` no servidor |
| Chave APNs (.p8) + Key ID | developer.apple.com > Keys > "+" > Apple Push Notifications service | `APNS_PRIVATE_KEY`, `APNS_KEY_ID` |
| `google-services.json` | Firebase > Definições do projeto > app Android | `android/app/google-services.json` (fica fora do git) |
| Conta de serviço Firebase (JSON) | Firebase > Definições > Contas de serviço > Gerar chave | `FCM_SERVICE_ACCOUNT_JSON` (uma linha) |
| SHA-256 da chave de assinatura | Play Console > Integridade da app > Assinatura | `ANDROID_CERT_SHA256` |

Com isto, `/.well-known/apple-app-site-association` e
`/.well-known/assetlinks.json` passam a responder e o QR lido pela câmara
abre a app. Nunca pôr estas chaves no git nem em variáveis `NEXT_PUBLIC_*`.

## Fase 4: builds

- **Android**: no Windows, com o Android Studio. `pnpm cap:android`,
  depois Build > Generate Signed App Bundle (.aab). Guardar o ficheiro
  `.jks` e a password num sítio seguro: sem eles não há atualizações (com
  "Play App Signing" a Google guarda a chave final, o que recomendo).
- **iOS**: precisa de um Mac com Xcode. Sem Mac há duas saídas: um serviço
  de build na cloud (Codemagic tem plano grátis; GitHub Actions tem máquinas
  macOS) ou um Mac emprestado uma tarde. No Xcode: Signing & Capabilities >
  escolher a tua equipa, confirmar "Push Notifications" e "Associated
  Domains", depois Product > Archive > enviar para o App Store Connect.

## Fase 5: testes

- iOS: TestFlight (testers internos logo; externos após uma revisão curta).
- Android: teste interno logo; teste fechado com 12 pessoas durante 14 dias
  (obrigatório em contas pessoais).
- Verificar no telemóvel real: câmara do QR dentro da app, login por SMS,
  pagamento MB WAY, notificação com a app fechada, toque na notificação abre
  o leilão, QR lido pela câmara do sistema abre a app, modo avião mostra
  "Sem ligação", botão voltar do Android, partilha para o Instagram.

## Fase 6: fichas das lojas

- Nome, subtítulo, descrição, palavras-chave (sem "aposta", "apostar",
  "odds", "ganhar").
- Capturas de ecrã: iPhone 6,9" e 6,5", iPad se a app correr em iPad;
  Android telemóvel. Posso gerá-las com Playwright a partir do site.
- URL da política de privacidade e página de suporte.
- Questionário de classificação etária e "Segurança dos dados" (Google) /
  "Privacidade da app" (Apple): número de telefone, identificadores de
  dispositivo para notificações, histórico de compras.
- **Conta e evento de demonstração para quem revê**: um evento sempre
  aberto e um número de telefone de teste com código fixo, senão a revisão
  falha porque não conseguem entrar.

## Fase 7: revisão, riscos conhecidos

1. **Apple 4.2 (funcionalidade mínima)**: a Apple rejeita apps que são "só
   um site". Por isso a casca tem push nativo, links universais, arranque e
   ecrã offline nativos. Se mesmo assim rejeitarem, o passo seguinte é
   leitor de QR nativo e vibração (haptics) nos lances.
2. **Pagamentos fora da Apple (3.1.1 / 3.1.5)**: o pedido de música é um
   serviço prestado na discoteca, fora da app, por isso pode usar MB WAY em
   vez de compras dentro da app (como pedir comida ou pagar estacionamento).
   Explicar isto nas notas para o revisor.
3. **"Parece jogo"**: explicar nas notas que o resultado é determinístico,
   o DJ decide sempre e quem não é tocado recebe o dinheiro de volta.
4. **Apagar conta**: as duas lojas exigem que quem cria conta (o número de
   telefone) a possa apagar dentro da app. Confirmar que o painel de saldo
   tem essa opção antes de submeter.

## Depois de publicada

Mudanças no site chegam logo à app. Só é preciso nova versão nas lojas
quando muda algo nativo (plugins, ícone, permissões, versão do Capacitor).
Subir `versionCode`/`versionName` em `android/app/build.gradle` e a versão no
Xcode a cada envio.
