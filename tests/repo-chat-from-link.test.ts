import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatFromLink, getChat } from "../src/lib/repo";
import { telegramChatId } from "../src/lib/chat-list";

// Runs against the in-memory store (no Supabase env configured under tests).

test("createChatFromLink builds a valid chat from a Telegram link", async () => {
  const link = "https://web.telegram.org/a/#-5171468893";
  const c = await createChatFromLink(link);
  assert.equal(c.chat_link, link);
  assert.equal(c.agr_no, `TG${telegramChatId(link)}`); // "TG-5171468893"
  assert.equal(c.status, "Active");
  assert.ok(c.chat_name); // chat_name is NOT NULL in the schema
  // Retrievable afterwards.
  assert.equal((await getChat(c.agr_no))?.agr_no, c.agr_no);
});

test("createChatFromLink is idempotent across web clients (same chat id)", async () => {
  const a = await createChatFromLink("https://web.telegram.org/a/#-4962919740");
  // Same conversation pasted via the "K" client must NOT create a duplicate.
  const k = await createChatFromLink("https://web.telegram.org/k/#-4962919740");
  assert.equal(k.agr_no, a.agr_no);
});

test("createChatFromLink respects a provided name", async () => {
  const c = await createChatFromLink(
    "https://web.telegram.org/a/#-4174815340",
    "ИП Тест"
  );
  assert.equal(c.chat_name, "ИП Тест");
});
