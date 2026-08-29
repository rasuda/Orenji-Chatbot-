import test from "node:test";
import assert from "node:assert/strict";
import { splitText } from "../src/index.js";

test("mantém mensagens curtas em um único bloco", () => {
  assert.deepEqual(splitText("Olá, mundo", 20), ["Olá, mundo"]);
});

test("divide mensagens longas sem perder o conteúdo", () => {
  const chunks = splitText("um dois três quatro cinco", 12);
  assert.deepEqual(chunks, ["um dois três", "quatro cinco"]);
  assert.ok(chunks.every((chunk) => chunk.length <= 12));
});
