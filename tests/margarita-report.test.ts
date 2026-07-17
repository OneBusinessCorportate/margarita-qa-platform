import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickMargaritaChatId,
  margaritaReportConfigured,
  resolveMargaritaWindow,
  yerevanToday,
  MARGARITA_QA_CHAT_ENV,
} from "../src/lib/margarita-report.ts";

test("pickMargaritaChatId prefers the dedicated chat, falls back to the shared one", () => {
  assert.equal(
    pickMargaritaChatId({ [MARGARITA_QA_CHAT_ENV]: "-100dedicated", TELEGRAM_CHAT_ID: "-100shared" }),
    "-100dedicated"
  );
  assert.equal(pickMargaritaChatId({ TELEGRAM_CHAT_ID: "-100shared" }), "-100shared");
  // Blank/whitespace dedicated → fall back, never send to an empty chat.
  assert.equal(
    pickMargaritaChatId({ [MARGARITA_QA_CHAT_ENV]: "   ", TELEGRAM_CHAT_ID: "-100shared" }),
    "-100shared"
  );
  assert.equal(pickMargaritaChatId({}), undefined);
});

test("margaritaReportConfigured needs a token AND some chat id", () => {
  assert.equal(margaritaReportConfigured({}), false);
  assert.equal(margaritaReportConfigured({ TELEGRAM_BOT_TOKEN: "t" }), false);
  assert.equal(margaritaReportConfigured({ TELEGRAM_CHAT_ID: "c" }), false);
  assert.equal(
    margaritaReportConfigured({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" }),
    true
  );
  assert.equal(
    margaritaReportConfigured({ TELEGRAM_BOT_TOKEN: "t", [MARGARITA_QA_CHAT_ENV]: "c" }),
    true
  );
});

test("resolveMargaritaWindow: a single date collapses to one day", () => {
  assert.deepEqual(resolveMargaritaWindow({ date: "2026-07-17" }), {
    from: "2026-07-17",
    to: "2026-07-17",
    accountant: undefined,
  });
});

test("resolveMargaritaWindow: an explicit range is preserved", () => {
  assert.deepEqual(resolveMargaritaWindow({ from: "2026-07-01", to: "2026-07-17" }), {
    from: "2026-07-01",
    to: "2026-07-17",
    accountant: undefined,
  });
});

test("resolveMargaritaWindow: a lone from/to collapses to that day, keeps accountant", () => {
  assert.deepEqual(resolveMargaritaWindow({ from: "2026-07-10", accountant: "Гаяне" }), {
    from: "2026-07-10",
    to: "2026-07-10",
    accountant: "Гаяне",
  });
});

test("resolveMargaritaWindow defaults to today (Yerevan) when nothing is given", () => {
  const today = yerevanToday();
  assert.deepEqual(resolveMargaritaWindow(), { from: today, to: today, accountant: undefined });
});

test("yerevanToday returns a YYYY-MM-DD string", () => {
  const d = yerevanToday(new Date("2026-07-17T22:30:00Z")); // 02:30 next day is NOT Yerevan (UTC+4 → 02:30 same day)
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  // 2026-07-17T22:30Z + 4h = 2026-07-18T02:30 Yerevan.
  assert.equal(d, "2026-07-18");
});
