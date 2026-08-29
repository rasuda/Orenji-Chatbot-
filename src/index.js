const TELEGRAM_API = "https://api.telegram.org";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 10;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, service: env.BOT_NAME || "Orenji AI" });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json({
        ok: true,
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
        geminiConfigured: Boolean(env.GEMINI_API_KEY),
        webhookSecretConfigured: Boolean(env.WEBHOOK_SECRET)
      });
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      return setupPage();
    }

    if (request.method === "POST" && url.pathname === "/setup-webhook") {
      return setupWebhook(request, env);
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (!isValidWebhook(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Responder rapidamente ao Telegram e continuar o processamento no Worker.
    const task = handleUpdate(update, env).catch((error) =>
      console.error("Erro ao processar mensagem", error)
    );
    ctx.waitUntil(task);
    return Response.json({ ok: true });
  }
};

function setupPage(message = "") {
  const status = message ? `<p class="status">${escapeHtml(message)}</p>` : "";
  return new Response(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Configurar Orenji AI</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#fff7ed;color:#292524;margin:0;padding:24px}
    main{max-width:480px;margin:8vh auto;background:white;padding:28px;border-radius:18px;box-shadow:0 12px 35px #9a341222}
    h1{color:#c2410c;margin-top:0}label{display:block;font-weight:600;margin:20px 0 8px}
    input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:10px;font-size:16px}
    input{border:1px solid #d6d3d1}button{margin-top:16px;border:0;background:#ea580c;color:white;font-weight:700}
    small{display:block;color:#78716c;margin-top:10px}.status{background:#fef3c7;padding:12px;border-radius:10px}
  </style>
</head>
<body><main>
  <h1>Orenji AI</h1>
  <p>Conecte o bot do Telegram a este Worker.</p>
  ${status}
  <form method="post" action="/setup-webhook">
    <label for="secret">Webhook secret</label>
    <input id="secret" name="secret" type="password" required autocomplete="off">
    <button type="submit">Conectar Telegram</button>
  </form>
  <small>O valor é enviado somente a este Worker para validar a configuração.</small>
</main></body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}

async function setupWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.WEBHOOK_SECRET) {
    return setupPage("Cadastre TELEGRAM_BOT_TOKEN e WEBHOOK_SECRET no Cloudflare antes de continuar.");
  }

  const form = await request.formData();
  if (form.get("secret") !== env.WEBHOOK_SECRET) {
    return new Response("Webhook secret incorreto.", { status: 401 });
  }

  const origin = new URL(request.url).origin;
  await telegramRequest(env, "setWebhook", {
    url: `${origin}/webhook`,
    secret_token: env.WEBHOOK_SECRET,
    drop_pending_updates: true
  });

  try {
    await askGemini(env, [], "Responda somente com a palavra OK.");
  } catch (error) {
    return setupPage(`Telegram conectado, mas o Gemini falhou: ${geminiDiagnostic(error)}`);
  }

  return setupPage("Telegram e Gemini conectados. Agora abra o bot e envie /start.");
}

function geminiDiagnostic(error) {
  const message = String(error?.message || error);
  if (message.includes(" 400:")) return "requisição rejeitada. Verifique o modelo configurado.";
  if (message.includes(" 401:")) return "chave de API inválida.";
  if (message.includes(" 403:")) return "chave sem permissão ou Gemini API não habilitada no projeto.";
  if (message.includes(" 404:")) return "modelo indisponível para esta chave/projeto.";
  if (message.includes(" 429:")) return "limite gratuito ou cota da API excedida.";
  return "erro inesperado ao acessar a API.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidWebhook(request, env) {
  if (!env.WEBHOOK_SECRET) return true;
  return request.headers.get("X-Telegram-Bot-Api-Secret-Token") === env.WEBHOOK_SECRET;
}

async function handleUpdate(update, env) {
  const message = update.message;
  if (!message?.chat?.id || typeof message.text !== "string") return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const firstName = message.from?.first_name || "";

  if (!text) return;

  if (text === "/start") {
    await sendTelegramMessage(env, chatId,
      `Olá${firstName ? `, ${firstName}` : ""}! Eu sou o ${env.BOT_NAME || "Orenji AI"}.\n\nEnvie uma pergunta e eu responderei usando o Gemini. Digite /ajuda para ver os comandos.`
    );
    return;
  }

  if (text === "/ajuda" || text === "/help") {
    await sendTelegramMessage(env, chatId,
      "Comandos disponíveis:\n/start — iniciar o bot\n/ajuda — mostrar esta ajuda\n/limpar — apagar o histórico da conversa"
    );
    return;
  }

  if (text === "/limpar") {
    if (env.CHAT_HISTORY) await env.CHAT_HISTORY.delete(chatId);
    await sendTelegramMessage(env, chatId, "Histórico apagado. Podemos começar novamente.");
    return;
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    await sendTelegramMessage(env, chatId, `A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`);
    return;
  }

  await sendChatAction(env, chatId, "typing");

  try {
    const history = await loadHistory(env, chatId);
    const answer = await askGemini(env, history, text);
    await sendLongMessage(env, chatId, answer);
    await saveHistory(env, chatId, [
      ...history,
      { role: "user", parts: [{ text }] },
      { role: "model", parts: [{ text: answer }] }
    ]);
  } catch (error) {
    console.error("Erro no Gemini", error);
    await sendTelegramMessage(env, chatId, "Não consegui responder agora. Tente novamente em alguns instantes.");
  }
}

async function askGemini(env, history, text) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada");

  const model = env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const response = await fetch(`${GEMINI_API}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "Você é o Orenji AI, um assistente útil, claro e objetivo. Responda em português do Brasil, salvo se o usuário pedir outro idioma. Não invente fatos; quando não souber, diga isso."
        }]
      },
      contents: [...history, { role: "user", parts: [{ text }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1200
      }
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${JSON.stringify(data)}`);

  const answer = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!answer) throw new Error("Gemini retornou uma resposta vazia");
  return answer;
}

async function loadHistory(env, chatId) {
  if (!env.CHAT_HISTORY) return [];
  const history = await env.CHAT_HISTORY.get(chatId, "json");
  return Array.isArray(history) ? history : [];
}

async function saveHistory(env, chatId, history) {
  if (!env.CHAT_HISTORY) return;
  await env.CHAT_HISTORY.put(chatId, JSON.stringify(history.slice(-MAX_HISTORY_ITEMS)), {
    expirationTtl: 60 * 60 * 24 * 7
  });
}

async function telegramRequest(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN não configurado");
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram: ${JSON.stringify(data)}`);
  return data;
}

function sendTelegramMessage(env, chatId, text) {
  return telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true }
  });
}

function sendChatAction(env, chatId, action) {
  return telegramRequest(env, "sendChatAction", { chat_id: chatId, action });
}

async function sendLongMessage(env, chatId, text) {
  const chunks = splitText(text, 4000);
  for (const chunk of chunks) await sendTelegramMessage(env, chatId, chunk);
}

function splitText(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let index = remaining.lastIndexOf("\n", maxLength);
    if (index < maxLength / 2) index = remaining.lastIndexOf(" ", maxLength);
    if (index < maxLength / 2) index = maxLength;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export { splitText };
