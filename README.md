# Orenji Chatbot

Chatbot para Telegram com respostas geradas pelo Gemini e backend serverless no Cloudflare Workers.

## O que já funciona

- Respostas do Gemini no Telegram
- Comandos `/start`, `/ajuda` e `/limpar`
- Indicador de digitação
- Divisão automática de respostas longas
- Validação secreta do webhook
- Histórico opcional por usuário usando Cloudflare KV
- Endpoint de diagnóstico em `/`

## Pré-requisitos

- Node.js 18 ou superior
- Conta gratuita na Cloudflare
- Bot criado pelo [@BotFather](https://t.me/BotFather)
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
```

Depois execute:

```bash
npm run dev
npm test
```

O arquivo `.dev.vars` está ignorado pelo Git e nunca deve ser enviado ao repositório.
