import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tallyRequestChats } from "../src/lib/repo.js";

// chat_id → accountant map (as countClientRequests builds from mqa_chats).
const chatIdToAcc = new Map<string, string>([
  ["-100", "Гаяне"],
  ["-200", "Гаяне"],
  ["-300", "Лилит"],
  ["-999", "Гаяне"], // a chat with no assigned accountant would be absent; here assigned
]);

describe("tallyRequestChats — unique chats, not messages (file-2 «Запрос» fix)", () => {
  it("five client messages in ONE chat count as ONE request", () => {
    const rows = Array.from({ length: 5 }, () => ({ chat_id: "-100" }));
    const res = tallyRequestChats(rows, chatIdToAcc);
    assert.deepEqual(res, [{ accountant: "Гаяне", count: 1 }]);
  });

  it("duplicate sync records (same chat repeated) do not inflate the count", () => {
    const rows = [
      { chat_id: "-100" }, { chat_id: "-100" }, { chat_id: -100 as unknown as number },
      { chat_id: "-200" }, { chat_id: "-200" },
    ];
    const res = tallyRequestChats(rows, chatIdToAcc);
    // Гаяне has 2 distinct chats (-100, -200), not 5 messages.
    assert.equal(res.find((r) => r.accountant === "Гаяне")?.count, 2);
  });

  it("counts unique chats per accountant and never exceeds their chat count", () => {
    const rows = [
      { chat_id: "-100" }, { chat_id: "-200" }, { chat_id: "-300" },
      { chat_id: "-300" }, { chat_id: "-300" },
    ];
    const res = tallyRequestChats(rows, chatIdToAcc);
    assert.equal(res.find((r) => r.accountant === "Гаяне")?.count, 2); // -100, -200
    assert.equal(res.find((r) => r.accountant === "Лилит")?.count, 1); // -300
  });

  it("a chat that maps to no accountant is ignored (not another accountant's)", () => {
    const rows = [{ chat_id: "-555" }, { chat_id: "-100" }];
    const res = tallyRequestChats(rows, chatIdToAcc);
    assert.equal(res.find((r) => r.accountant === "Гаяне")?.count, 1);
    assert.equal(res.reduce((s, r) => s + r.count, 0), 1);
  });
});
