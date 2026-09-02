# Orenji Chatbot

Chatbot para Telegram e WhatsApp com respostas geradas pelo Gemini e backend serverless no Cloudflare Workers.

## O que já funciona

- Respostas do Gemini no Telegram
- Respostas do Gemini no WhatsApp Cloud API
- Atendimento institucional baseado nas soluções e competências da Orenji
- Comandos `/start`, `/ajuda` e `/limpar`
- Indicador de digitação
- Divisão automática de respostas longas
- Validação secreta do webhook
- Validação da assinatura HMAC dos webhooks da Meta
- Histórico opcional por usuário usando Cloudflare KV
- Endpoints de diagnóstico em `/` e `/status`

## Atendimento institucional

O Gemini recebe uma base institucional incorporada ao Worker a partir das informações oficiais publicadas em:

- https://rasuda.github.io/Orenji-site/
- https://www.linkedin.com/company/orenji-data-science/

O bot atua como assistente virtual consultivo, explica as soluções de Analytics & BI, Inteligência Artificial, Automação e Plataformas de Dados e encaminha oportunidades para os canais oficiais. Ele também é orientado a não inventar preços, prazos, clientes, cases ou competências não publicadas.

## Pré-requisitos

- Node.js 18 ou superior
- Conta gratuita na Cloudflare
- Bot criado pelo [@BotFather](https://t.me/BotFather)
- Aplicativo configurado no [Meta for Developers](https://developers.facebook.com/)
- Chave criada no [Google AI Studio](https://aistudio.google.com/apikey)

## 1. Instalar e autenticar

```bash
npm install
npx wrangler login
```

## 2. Cadastrar os segredos

Não coloque tokens no código ou no arquivo `wrangler.toml`.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
```

Para `WEBHOOK_SECRET`, crie uma senha aleatória com letras, números, `_` e `-`. Guarde-a para cadastrar o webhook.

## 3. Publicar

```bash
npm run deploy
```

Ao final, a Cloudflare exibirá uma URL parecida com:

```text
https://orenji-chatbot.SEUSUBDOMINIO.workers.dev
```

Abra essa URL no navegador. O retorno deve conter `"ok": true`.

## 4. Conectar o Telegram ao Worker

Troque os três valores abaixo e execute no terminal:

```bash
curl -X POST "https://api.telegram.org/botSEU_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://orenji-chatbot.SEUSUBDOMINIO.workers.dev/webhook","secret_token":"SEU_WEBHOOK_SECRET","drop_pending_updates":true}'
```

Confirme a configuração:

```bash
curl "https://api.telegram.org/botSEU_TOKEN/getWebhookInfo"
```

Depois, abra o bot no Telegram, toque em **Iniciar** e envie uma pergunta.

## 5. Conectar o WhatsApp de teste

No painel **Meta for Developers**, abra seu aplicativo e adicione o produto WhatsApp. Na área de configuração da API, copie:

- Token de acesso temporário para `WHATSAPP_ACCESS_TOKEN`
- Identificação do número de telefone para `WHATSAPP_PHONE_NUMBER_ID`
- Segredo do aplicativo em **App settings > Basic** para `WHATSAPP_APP_SECRET`

Crie também uma senha aleatória própria para `WHATSAPP_VERIFY_TOKEN`. Ela será informada tanto no Cloudflare quanto na Meta.

No Cloudflare, cadastre os quatro valores como **Secret** em **Settings > Variables and Secrets** e selecione **Deploy**.

Na configuração de webhooks da Meta, informe:

```text
Callback URL: https://orenji-chatbot.rasuda.workers.dev/webhook/whatsapp
Verify token: o mesmo valor de WHATSAPP_VERIFY_TOKEN
```

Depois:

1. Assine o campo `messages` do webhook.
2. Cadastre seu celular como destinatário autorizado no painel de teste.
3. Envie uma mensagem ao número de teste fornecido pela Meta.

O token temporário da Meta expira. Para uma integração permanente, substitua-o posteriormente por um token de acesso permanente com as permissões necessárias.

## Histórico opcional

Sem KV, o bot responde normalmente, mas cada mensagem é independente. Para manter contexto:

```bash
npx wrangler kv namespace create CHAT_HISTORY
```

Copie o `id` retornado, descomente `[[kv_namespaces]]` em `wrangler.toml` e substitua `COLE_AQUI_O_ID_DO_KV`. Publique novamente:

```bash
npm run deploy
```

O histórico mantém as últimas 10 mensagens e expira após 7 dias.

## Desenvolvimento local

Crie `.dev.vars` apenas no computador local:

```text
TELEGRAM_BOT_TOKEN="..."
GEMINI_API_KEY="..."
WEBHOOK_SECRET="..."
WHATSAPP_ACCESS_TOKEN="..."
WHATSAPP_PHONE_NUMBER_ID="..."
WHATSAPP_VERIFY_TOKEN="..."
WHATSAPP_APP_SECRET="..."
```

Depois execute:

```bash
npm run dev
npm test
```

O arquivo `.dev.vars` está ignorado pelo Git e nunca deve ser enviado ao repositório.

## Endpoints

| Método | Endpoint | Finalidade |
|---|---|---|
| `GET` | `/` | Saúde do serviço |
| `GET` | `/status` | Confirma quais integrações estão configuradas, sem revelar segredos |
| `POST` | `/webhook` | Recebe mensagens do Telegram |
| `GET` | `/webhook/whatsapp` | Validação inicial do webhook da Meta |
| `POST` | `/webhook/whatsapp` | Recebe mensagens do WhatsApp |
| `GET` | `/setup` | Assistente de configuração do Telegram |
