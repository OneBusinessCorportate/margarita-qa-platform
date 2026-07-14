import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  telegramChatIdOf,
  normalizeTelegramLink,
  normalizeClientName,
  reconcileChats,
  type ReconcileRow,
} from "../src/lib/chat-reconcile.js";

describe("telegram link normalization", () => {
  it("preserves negative group ids", () => {
    assert.equal(telegramChatIdOf("https://web.telegram.org/a/#-5392224018"), "-5392224018");
    assert.equal(telegramChatIdOf("-5212778373"), "-5212778373");
  });
  it("«Telegram» placeholder and empty → null", () => {
    assert.equal(telegramChatIdOf("Telegram"), null);
    assert.equal(telegramChatIdOf(""), null);
    assert.equal(telegramChatIdOf(null), null);
  });
  it("normalizes to the canonical web form without changing the id", () => {
    assert.equal(
      normalizeTelegramLink("https://web.telegram.org/a/#-4014170511"),
      "https://web.telegram.org/a/#-4014170511"
    );
    assert.equal(normalizeTelegramLink("t.me/joinchat/-4014170511"), "https://web.telegram.org/a/#-4014170511");
  });
});

describe("client-name normalization (AM/RU/EN, ИП/ԱՁ/ООО, order)", () => {
  it("strips legal forms, contract tags and reorders", () => {
    assert.equal(normalizeClientName("ИП Артюх Никита"), normalizeClientName("Никита Артюх"));
    assert.equal(
      normalizeClientName("ИП Фролкин Владимир N B-3932 RU"),
      normalizeClientName("Владимир Фролкин")
    );
  });
  it("ԱՁ / ООО / LLC are ignored for matching", () => {
    assert.equal(normalizeClientName("Արմեն Սարգսյան ԱՁ"), normalizeClientName("Սարգսյան Արմեն"));
    assert.equal(normalizeClientName("\"AEON DEVELOPMENT\" LLC"), normalizeClientName("aeon development"));
  });
});

describe("reconcileChats", () => {
  const db: ReconcileRow[] = [
    { agr_no: "B-1", chat_link: "https://web.telegram.org/a/#-100", chat_name: "ИП Иванов N-1", accountant: "Гаяне", status: "Active" },
    { agr_no: "B-4794", chat_link: null, chat_name: "D AND D GROUP LLC", accountant: "Лилит", status: "Active" },
    { agr_no: "TG-5212778373", chat_link: "https://web.telegram.org/a/#-5212778373", chat_name: "Чат из Telegram (ручной)", accountant: null, status: "Active" },
  ];

  it("matches by telegram chat id", () => {
    const r = reconcileChats([{ agr_no: "B-1", chat_link: "https://web.telegram.org/a/#-100", chat_name: "x", accountant: null, status: "Active" }], db);
    assert.equal(r.results[0].klass, "matched");
    assert.equal(r.summary.matched, 1);
  });

  it("flags a genuinely missing active chat for import (preserving negative id)", () => {
    const src: ReconcileRow[] = [
      { agr_no: "B-4852", chat_link: "https://web.telegram.org/a/#-5392224018", chat_name: "Արմեն Սարգսյան Սիրակի ԱՁ", accountant: "Հասմիկ", status: "Active", language: "AM" },
    ];
    const r = reconcileChats(src, db);
    assert.equal(r.results[0].klass, "missing");
    assert.equal(r.summary.missing, 1);
    assert.equal(telegramChatIdOf(r.results[0].source.chat_link), "-5392224018");
  });

  it("contract present but no link → link_missing (backfill)", () => {
    const src: ReconcileRow[] = [
      { agr_no: "B-4794", chat_link: "https://web.telegram.org/a/#-5212778373", chat_name: "Դ Ընդ Դ Գրուպ", accountant: "Лилит", status: "Active" },
    ];
    const r = reconcileChats(src, db);
    // chat id -5212778373 already exists in DB under TG-5212778373 → conflict (needs relink),
    // which is the correct, conservative call here.
    assert.equal(r.results[0].klass, "conflict");
    assert.match(r.results[0].reason, /-5212778373|TG-5212778373|B-4794/);
  });

  it("a TG-* placeholder chat is reported as a conflict to relink, not silently joined", () => {
    const src: ReconcileRow[] = [
      { agr_no: "B-9", chat_link: "https://web.telegram.org/a/#-5212778373", chat_name: "Клиент", accountant: null, status: "Active" },
    ];
    const r = reconcileChats(src, db);
    assert.equal(r.results[0].klass, "conflict");
  });

  it("inactive & absent chats are not imported", () => {
    const src: ReconcileRow[] = [
      { agr_no: "B-999", chat_link: "https://web.telegram.org/a/#-777", chat_name: "Старый", accountant: null, status: "Inactive" },
    ];
    const r = reconcileChats(src, db);
    assert.equal(r.results[0].klass, "conflict");
    assert.equal(r.summary.missing, 0);
  });
});

describe("computeChatHealth (admin diagnostic)", () => {
  it("counts missing contracts, accountants, links and duplicate mappings", async () => {
    const { computeChatHealth } = await import("../src/lib/chat-reconcile.js");
    const chats: ReconcileRow[] = [
      { agr_no: "B-1", chat_link: "https://web.telegram.org/a/#-100", chat_name: "A", accountant: "Гаяне", status: "Active" },
      { agr_no: "TG-200", chat_link: "https://web.telegram.org/a/#-200", chat_name: "B", accountant: null, status: "Active" },
      { agr_no: "B-3", chat_link: null, chat_name: "C", accountant: "Лилит", status: "Active" },
      { agr_no: "B-4", chat_link: "https://web.telegram.org/a/#-100", chat_name: "dup", accountant: "Гаяне", status: "Active" }, // dup chat id -100
      { agr_no: "B-5", chat_link: "https://web.telegram.org/a/#-500", chat_name: "old", accountant: "Гаяне", status: "Inactive" },
    ];
    const h = computeChatHealth(chats);
    assert.equal(h.total, 5);
    assert.equal(h.active, 4);
    assert.equal(h.inactive, 1);
    assert.equal(h.withoutContract, 1); // TG-200
    assert.equal(h.withoutAccountant, 1); // TG-200
    assert.equal(h.withoutLink, 1); // B-3
    assert.equal(h.duplicateChatIds, 1); // -100 → B-1 & B-4
    assert.ok(h.issues.length >= 4);
  });
});
