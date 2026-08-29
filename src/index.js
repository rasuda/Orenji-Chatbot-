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
