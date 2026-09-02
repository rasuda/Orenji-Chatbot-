const TELEGRAM_API = "https://api.telegram.org";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const META_GRAPH_API = "https://graph.facebook.com";
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 10;

const ORENJI_COMPANY_CONTEXT = `
INFORMAÇÕES OFICIAIS SOBRE A ORENJI

Nome: Orenji Data Science & AI.
Posicionamento: "Transformamos dados em caminhos mais claros."
Proposta: estratégia, análise, automação e inteligência artificial para empresas que querem decidir melhor.

Soluções:
1. Analytics & BI: dashboards que simplificam indicadores e aceleram decisões.
2. Inteligência Artificial: modelos e assistentes aplicados a desafios reais do negócio.
3. Automação: processos inteligentes que reduzem tarefas manuais e retrabalho.
4. Plataformas de dados: informações organizadas, confiáveis e prontas para análise.

Abordagem:
- Entender: descobrir o que os dados do cliente revelam.
- Simplificar: transformar assuntos complexos em insights claros.
- Automatizar: construir soluções capazes de ganhar escala.
- Evoluir: apoiar decisões melhores e o crescimento contínuo.

Exemplos de aplicações divulgadas:
- Dashboard executivo para centralizar indicadores comerciais e financeiros.
- Automação de rotinas repetitivas para reduzir tempo e retrabalho operacional.
- Análises preditivas para antecipar cenários e apoiar decisões de negócio.

Forma de atuação: a Orenji une estratégia, engenharia de dados e inteligência artificial para transformar informações dispersas em clareza, eficiência e ação. Trabalha de forma próxima ao cliente e adapta as soluções à maturidade e aos objetivos de cada negócio. A conversa começa pelo problema do cliente, não pela tecnologia.

Canais oficiais:
- Site: https://rasuda.github.io/Orenji-site/
- LinkedIn: https://www.linkedin.com/company/orenji-data-science/
- E-mail: orenjidatascience@gmail.com
- WhatsApp: +55 11 98269-6472
`.trim();

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
        webhookSecretConfigured: Boolean(env.WEBHOOK_SECRET),
        whatsappConfigured: Boolean(
          env.WHATSAPP_ACCESS_TOKEN &&
          env.WHATSAPP_PHONE_NUMBER_ID &&
          env.WHATSAPP_VERIFY_TOKEN &&
          env.WHATSAPP_APP_SECRET
        ),
        geminiModel: env.GEMINI_MODEL || "gemini-3.1-flash-lite"
      });
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      return setupPage();
    }

    if (request.method === "POST" && url.pathname === "/setup-webhook") {
      return setupWebhook(request, env);
    }

    if (url.pathname === "/webhook/whatsapp" && request.method === "GET") {
      return verifyWhatsAppWebhook(url, env);
    }

    if (url.pathname === "/webhook/whatsapp" && request.method === "POST") {
      return receiveWhatsAppWebhook(request, env, ctx);
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

function verifyWhatsAppWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=UTF-8" }
    });
  }

  return new Response("Forbidden", { status: 403 });
}

async function receiveWhatsAppWebhook(request, env, ctx) {
  if (!isWhatsAppConfigured(env)) {
    return new Response("WhatsApp not configured", { status: 503 });
  }

  const rawBody = await request.text();
  if (!(await isValidMetaSignature(rawBody, request.headers, env.WHATSAPP_APP_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (update.object !== "whatsapp_business_account") {
    return new Response("Not found", { status: 404 });
  }

  const task = handleWhatsAppUpdate(update, env).catch((error) =>
    console.error("Erro ao processar mensagem do WhatsApp", error)
  );
  ctx.waitUntil(task);
  return Response.json({ ok: true });
}

function isWhatsAppConfigured(env) {
  return Boolean(
    env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    env.WHATSAPP_VERIFY_TOKEN &&
    env.WHATSAPP_APP_SECRET
  );
}

async function isValidMetaSignature(rawBody, headers, appSecret) {
  const signatureHeader = headers.get("X-Hub-Signature-256") || "";
  if (!appSecret || !signatureHeader.startsWith("sha256=")) return false;

  const signature = hexToBytes(signatureHeader.slice(7));
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(rawBody));
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
}

function extractWhatsAppMessages(update) {
  const messages = [];
  for (const entry of update.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = new Map(
        (value.contacts || []).map((contact) => [contact.wa_id, contact.profile?.name || ""])
      );
      for (const message of value.messages || []) {
        messages.push({
          id: message.id,
          from: message.from,
          name: contacts.get(message.from) || "",
          type: message.type,
          text: message.text?.body || ""
        });
      }
    }
  }
  return messages;
}

async function handleWhatsAppUpdate(update, env) {
  for (const message of extractWhatsAppMessages(update)) {
    if (!message.id || !message.from || await isDuplicateWhatsAppMessage(env, message.id)) continue;

    if (message.type !== "text") {
      await sendWhatsAppMessage(env, message.from,
        "No momento, consigo responder apenas mensagens de texto."
      );
      continue;
    }

    const text = message.text.trim();
    if (!text) continue;
    const command = text.toLocaleLowerCase("pt-BR");

    if (["/start", "start", "iniciar"].includes(command)) {
      await sendWhatsAppMessage(env, message.from,
        `Olá${message.name ? `, ${message.name}` : ""}! Eu sou o ${env.BOT_NAME || "Orenji AI"}, assistente virtual da Orenji Data Science & AI. Posso explicar nossas soluções e ajudar a entender como podemos apoiar o seu negócio.`
      );
      continue;
    }

    if (["/ajuda", "ajuda", "/help"].includes(command)) {
      await sendWhatsAppMessage(env, message.from,
        "Pergunte sobre Analytics & BI, Inteligência Artificial, Automação ou Plataformas de Dados. Digite limpar para apagar o histórico."
      );
      continue;
    }

    const conversationId = `whatsapp:${message.from}`;
    if (["/limpar", "limpar"].includes(command)) {
      if (env.CHAT_HISTORY) await env.CHAT_HISTORY.delete(conversationId);
      await sendWhatsAppMessage(env, message.from, "Histórico apagado. Podemos começar novamente.");
      continue;
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      await sendWhatsAppMessage(env, message.from,
        `A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`
      );
      continue;
    }

    try {
      const answer = await generateReply(env, conversationId, text);
      await sendLongWhatsAppMessage(env, message.from, answer);
    } catch (error) {
      console.error("Erro no Gemini para WhatsApp", error);
      await sendWhatsAppMessage(env, message.from,
        "Não consegui responder agora. Tente novamente em alguns instantes."
      );
    }
  }
}

async function isDuplicateWhatsAppMessage(env, messageId) {
  if (!env.CHAT_HISTORY) return false;
  const key = `whatsapp-message:${messageId}`;
  if (await env.CHAT_HISTORY.get(key)) return true;
  await env.CHAT_HISTORY.put(key, "1", { expirationTtl: 60 * 60 * 24 });
  return false;
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
      `Olá${firstName ? `, ${firstName}` : ""}! Eu sou o ${env.BOT_NAME || "Orenji AI"}, assistente virtual da Orenji Data Science & AI.\n\nPosso explicar nossas soluções e ajudar a entender como podemos apoiar o seu negócio. Digite /ajuda para ver os comandos.`
    );
    return;
  }

  if (text === "/ajuda" || text === "/help") {
    await sendTelegramMessage(env, chatId,
      "Pergunte sobre Analytics & BI, Inteligência Artificial, Automação ou Plataformas de Dados.\n\nComandos:\n/start — iniciar o bot\n/ajuda — mostrar esta ajuda\n/limpar — apagar o histórico"
    );
    return;
  }

  if (text === "/limpar") {
    if (env.CHAT_HISTORY) await env.CHAT_HISTORY.delete(`telegram:${chatId}`);
    await sendTelegramMessage(env, chatId, "Histórico apagado. Podemos começar novamente.");
    return;
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    await sendTelegramMessage(env, chatId, `A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`);
    return;
  }

  await sendChatAction(env, chatId, "typing");

  try {
    const conversationId = `telegram:${chatId}`;
    const answer = await generateReply(env, conversationId, text);
    await sendLongMessage(env, chatId, answer);
  } catch (error) {
    console.error("Erro no Gemini", error);
    await sendTelegramMessage(env, chatId, "Não consegui responder agora. Tente novamente em alguns instantes.");
  }
}

async function generateReply(env, conversationId, text) {
  const history = await loadHistory(env, conversationId);
  const answer = await askGemini(env, history, text);
  await saveHistory(env, conversationId, [
    ...history,
    { role: "user", parts: [{ text }] },
    { role: "model", parts: [{ text: answer }] }
  ]);
  return answer;
}

async function askGemini(env, history, text) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada");

  const model = env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const currentDateTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date());
  const response = await fetch(`${GEMINI_API}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: buildSystemInstruction(currentDateTime)
        }]
      },
      contents: [...history, { role: "user", parts: [{ text }] }],
      generationConfig: {
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

function buildSystemInstruction(currentDateTime) {
  return `Você é o Orenji AI, assistente virtual de atendimento da Orenji Data Science & AI.

Seu papel é conversar como um atendente consultivo da empresa: entender a dúvida, explicar soluções e competências com clareza, identificar oportunidades e orientar o próximo passo. Nunca diga que é uma pessoa ou funcionário humano; apresente-se como assistente virtual quando isso for relevante.

Use somente as informações institucionais abaixo para fazer afirmações sobre a Orenji:

${ORENJI_COMPANY_CONTEXT}

REGRAS DE ATENDIMENTO
- Responda em português do Brasil, salvo se o usuário pedir outro idioma.
- Seja cordial, objetivo, próximo e profissional. Evite linguagem excessivamente técnica.
- Relacione a necessidade apresentada à solução mais adequada e explique o benefício esperado sem prometer resultado garantido.
- Quando faltar contexto, faça no máximo duas perguntas curtas e úteis, por exemplo sobre o problema, processo atual, dados disponíveis ou objetivo.
- Quando houver interesse comercial, convide o usuário a explicar o desafio e ofereça os canais oficiais para continuar a conversa.
- Não invente clientes, projetos concluídos, depoimentos, certificações, preços, prazos, tamanho da equipe, tecnologias específicas ou resultados que não constem na base oficial.
- Se perguntarem preço ou prazo, explique que dependem do escopo e sugira uma conversa para levantamento da necessidade.
- Se uma informação sobre a empresa não estiver na base, diga que não possui essa confirmação e indique o contato oficial.
- Para assuntos sem relação com a Orenji, responda brevemente que seu foco é orientar sobre as soluções e competências da empresa.
- A data e hora atuais no horário de Brasília são: ${currentDateTime}.
- Você não possui acesso automático à internet, clima, notícias ou outros dados em tempo real. Nunca invente dados atuais.
- Responda em texto simples, adequado ao Telegram e WhatsApp, sem Markdown, asteriscos, títulos ou tabelas.`;
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

async function whatsappRequest(env, body) {
  const version = env.META_GRAPH_API_VERSION || "v23.0";
  const response = await fetch(
    `${META_GRAPH_API}/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(`WhatsApp ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function sendWhatsAppMessage(env, to, text) {
  return whatsappRequest(env, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text }
  });
}

async function sendLongWhatsAppMessage(env, to, text) {
  for (const chunk of splitText(text, 4000)) {
    await sendWhatsAppMessage(env, to, chunk);
  }
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

export { buildSystemInstruction, extractWhatsAppMessages, isValidMetaSignature, splitText };
