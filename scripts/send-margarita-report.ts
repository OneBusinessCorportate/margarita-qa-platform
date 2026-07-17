// ---------------------------------------------------------------------------
// Daily «Апелляции и QA Маргариты» Telegram report — automatic sender.
//
//   npm run report:margarita                     # send TODAY's report (Yerevan)
//   npm run report:margarita -- --dry-run        # print the message, send NOTHING
//   npm run report:margarita -- --date 2026-07-17
//   npm run report:margarita -- --from 2026-07-01 --to 2026-07-17
//   npm run report:margarita -- --accountant "Гаяне"
//
// Runs as a Render cron service (see render.yaml) so the site does NOT need to
// be awake for the report to go out. Shares the SAME assembler as the manual
// API route (/api/telegram/margarita-report), so cron and "send now" always
// produce the identical message.
//
// Env required:
//   TELEGRAM_BOT_TOKEN                — the bot token
//   TELEGRAM_CHAT_ID                  — target chat (shared with the main report)
//   MARGARITA_QA_TELEGRAM_CHAT_ID     — OPTIONAL: separate chat just for this report
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  — to read Margarita's QA data
//
// No AI, no Excel — only Margarita's own QA data (mqa_violations / mqa_violation_appeals).
// ---------------------------------------------------------------------------
import {
  assembleMargaritaReport,
  pickMargaritaChatId,
  MARGARITA_QA_CHAT_ENV,
} from "../src/lib/margarita-report";
import { postTelegramMessage } from "../src/lib/telegram-core";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const opts = {
    date: arg("date"),
    from: arg("from"),
    to: arg("to"),
    accountant: arg("accountant"),
  };

  // Fail loudly if Supabase isn't configured — otherwise we'd send an all-zero
  // report built from the empty in-memory store (misleading "quiet day").
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Supabase не настроен (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). " +
        "Отчёт не отправлен, чтобы не показать ложные нули."
    );
    process.exit(1);
  }

  const { window, message } = await assembleMargaritaReport(opts);

  if (dryRun) {
    console.log(`--dry-run: окно ${window.from}..${window.to}, сообщение ниже (не отправлено):\n`);
    console.log(message);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = pickMargaritaChatId();
  if (!token || !chatId) {
    console.error(
      `Telegram бот не настроен: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID ` +
        `(или ${MARGARITA_QA_CHAT_ENV} для отдельного чата).`
    );
    process.exit(1);
  }

  const res = await postTelegramMessage(token, chatId, message);
  if (!res.ok) {
    console.error(`Отправка не удалась: ${res.error}`);
    process.exit(1);
  }
  const target = process.env[MARGARITA_QA_CHAT_ENV] ? MARGARITA_QA_CHAT_ENV : "TELEGRAM_CHAT_ID";
  console.log(`Отчёт отправлен (${window.from}..${window.to}) → чат из ${target}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
