import test from "node:test";
import assert from "node:assert/strict";
import { extractWhatsAppMessages, isValidMetaSignature, splitText } from "../src/index.js";

test("mantém mensagens curtas em um único bloco", () => {
  assert.deepEqual(splitText("Olá, mundo", 20), ["Olá, mundo"]);
});

test("divide mensagens longas sem perder o conteúdo", () => {
  const chunks = splitText("um dois três quatro cinco", 12);
  assert.deepEqual(chunks, ["um dois três", "quatro cinco"]);
  assert.ok(chunks.every((chunk) => chunk.length <= 12));
});

test("extrai mensagens de texto do webhook do WhatsApp", () => {
  const messages = extractWhatsAppMessages({
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: "5511999999999", profile: { name: "Rafael" } }],
      messages: [{
        id: "wamid.123",
        from: "5511999999999",
        type: "text",
        text: { body: "Olá" }
      }]
    } }] }]
  });

  assert.deepEqual(messages, [{
    id: "wamid.123",
    from: "5511999999999",
    name: "Rafael",
    type: "text",
    text: "Olá"
  }]);
});

test("valida a assinatura HMAC enviada pela Meta", async () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const secret = "segredo-de-teste";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const signature = Array.from(signed, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const headers = new Headers({ "X-Hub-Signature-256": `sha256=${signature}` });

  assert.equal(await isValidMetaSignature(body, headers, secret), true);
  assert.equal(await isValidMetaSignature(`${body}alterado`, headers, secret), false);
});
