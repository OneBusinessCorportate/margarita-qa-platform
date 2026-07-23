-- ---------------------------------------------------------------------------
-- mqa_detect_mailings v16 — распознавание рассылки на КИТАЙСКОМ (中文).
--
-- Причина: фирма обслуживает китаеязычных клиентов, и штатные рассылки уходят
-- в том числе на китайском — запрос документов/ЗП («请提供 __ 月份的以下信息…
-- 发票、合同、CMR、报关单… 工资计算所需的数据»), напоминание об оплате услуг
-- («请于每月5日前支付会计服务费用… 会计服务费… 付款用途»), уведомления по
-- налогам/зарплате. Раньше движок знал только RU/HY/EN, поэтому китайские
-- рассылки не подтягивались вообще и отмечались вручную.
--
-- Что делает v16: строго АДДИТИВНО добавляет китайские сигналы, зеркалящие
-- RU/HY/EN-набор (done/req/neg + мягкий catch-all + напоминание об оплате
-- услуг). В китайском нет границ слов/пробелов, поэтому все шаблоны —
-- подстроки, а отрицание использует префиксы 未/没/尚未 (neg_zh). «Голые» 税
-- (налог) и 报表 (отчёт) НЕ используются — они есть в шаблоне оплаты услуг
-- («税务优化», «提交报表») и дали бы ложную «отправку налогов»; берём точные
-- сочетания (税款/报税/申报/增值税…).
--
-- Плюс точечный фикс RU: стем «готов» в глаголах-«выполнено» заякорен к началу
-- слова (`\mготов`), чтобы «ПОДготовки/ПОДготовлен» (подготовка отчётности) НЕ
-- давало ложного done. Штатный запрос документов открывается словами «Для
-- своевременной и корректной ПОДГОТОВКИ отчётности просим предоставить…» —
-- раньше «подготовки» ловилось как «готов» и REQUEST помечался «Получил»/
-- «Отправил». Всё прочее байт-в-байт как v15.
-- Держим в паритете с src/lib/mailings-detect.ts (KW.*_zh + *_ZH; DONE_*_RU).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mqa_detect_mailings(period_ym text DEFAULT to_char(CASE WHEN (EXTRACT(day FROM (now() AT TIME ZONE 'Asia/Yerevan'::text)) >= (28)::numeric) THEN ((now() AT TIME ZONE 'Asia/Yerevan'::text) + '1 mon'::interval) ELSE (now() AT TIME ZONE 'Asia/Yerevan'::text) END, 'YYYYMM'::text))
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  period_start timestamptz;
  period_end   timestamptz;
  neg_done constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(получ|пришл|прислал|подпис|сдал|сдела|сдан|подан|предостав|скинул|сброс|отправ|выслал|переслал|направ|подал|загруз|выгруз|отчита|задеклар|готов|выполн|оформ|провед)';
  neg_send constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(рассыл|разосл|разошл|уведом|сообщ|информир|напомн|отправ|выслал|переслал|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед|подал|подан|сдан|сдела|сделан|загруз|выгруз|отчита|задеклар|оформ|провед|провёл|провел|готов|выполн)';
  neg_paid constant text :=
    '\mне\M[[:space:]]+([[:alpha:]]+[[:space:]]+){0,2}(оплат|оплач|выплат|погас|закрыт)';
  neg_hy constant text :=
    'չ(ի|ե[մսնք]|եք|կա|ստաց|ուղարկ|ներկայաց|հանձն|տրամ|վճար|մար|փակ|կատար|արվ)';
  neg_send_hy constant text :=
    'չ(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)|չ(ի|ե[մսնք]{1,2}|կա)[[:space:]]+([^[:space:]]+[[:space:]]+){0,2}(ուղարկ|ներկայաց|հանձն|տեղեկաց|հիշեց|առաք|ցր)';
  svc_pay constant text :=
    '(оплатите[[:space:]]+(бухгалтерск|услуг|наши)|произвести[[:space:]]+оплату|о[[:space:]]+необходимости[[:space:]]+(произвести[[:space:]]+)?оплат|напоминаем[^.!?]{0,40}оплат|просим[[:space:]]+оплат|оплат[[:alpha:]]*[[:space:]]+([[:alpha:]]+[[:space:]]+){0,3}бухгалтерск[[:alpha:]]*[[:space:]]+(услуг|обслуживани)|стоимост[[:alpha:]]*[[:space:]]+бухгалтерск[[:alpha:]]*[[:space:]]+обслуживани|payment[[:space:]]+for[[:space:]]+account(ant|ing)[[:space:]]+servic|pay[[:space:]]+for[[:space:]]+account(ing|ant)[[:space:]]+servic|վճարումը[[:space:]]+կատար|կատարեք[[:space:]]+հաշվապահական[[:space:]]+ծառայ|հաշվապահական[[:space:]]+(ծառայ|սպասարկ)[[:alpha:]]*[[:space:]]+վճар)';
  debt_soft_ru constant text :=
    '(взыскан|неуплач|просроч|недоимк|к[[:space:]]+уплате|последн[[:alpha:]]+[[:space:]]+день[^.!?]{0,25}оплат|оплат[[:alpha:]]*[^.!?]{0,20}(до[[:space:]]+[0-9]|до[[:space:]]+установленн|срок)|напоминаем[^.!?]{0,40}(оплат|погас|задолж)|просим[^.!?]{0,30}(погас|оплат[[:alpha:]]*[[:space:]]+задолж))';
  debt_soft_hy constant text :=
    '(գանձ|չվճար|վճար[[:alpha:]]*[[:space:]]+մինչև|ժամկետ[^։.!?]{0,20}վճար|վճար[^։.!?]{0,20}ժամկետ)';
  debt_notice constant text :=
    '(взыскан|неуплач|просроч|порядок[[:space:]]+взыскан)';
  mailing_ru constant text :=
    '(рассыл|разосл|разошл|уведомл|уведомил|уведомля|напоминани|напоминаем|напоминаю|напомнил|напомин|информир|информацион|оповещ|извещ|оповестил|известил)';
  mailing_hy constant text :=
    '(տեղեկացն|տեղեկացր|հիշեցն|ծանուց|իրազեկ)';
  -- ---- Chinese (中文) — v16 (parity with *_ZH constants in mailings-detect.ts) --
  taxes_zh constant text :=
    '(税款|报税|纳税|增值税|申报|完税|税单|所得税|社会保险费|印花税|营业税)';
  salary_zh constant text :=
    '(工资|薪资|薪酬|工资表|工资单|工资核算|工资计算|发放工资)';
  primary_zh constant text :=
    '(发票|合同|报关|清关|进出口|进口|出口|单据|凭证|服务确认单|提单|运单|海关|商品文件|随附单据|税号|HS编码)';
  debts_zh constant text :=
    '(欠款|欠费|债务|逾期|拖欠|催款|催缴|催收|欠账|尾款)';
  done_tax_zh constant text :=
    '(已(提交|申报|报送|上报|提报|递交|发送|完成|办理)|申报完成|提交完毕|已在银行(开具|列出|办理))';
  done_recv_zh constant text :=
    '(已(收到|接收|取得|收讫|上传|发送|寄出|提供|整理|准备)|收到了|均已收到|已发放)';
  req_zh constant text :=
    '(请(提供|发送|提交|分享|上传|尽快|协助|配合|补充|于)|烦请|敬请|请您|需要您?提供|麻烦提供)';
  notify_zh constant text :=
    '(通知|提醒|温馨提示|谨此(通知|提醒)|特此(通知|告知)|告知|敬请知悉|现(通知|告知))';
  mailing_zh constant text :=
    '(通知|提醒|温馨提示|告知|提示|通告|公告|函告)';
  svc_pay_zh constant text :=
    '(支付会计服务|会计服务费|缴纳.{0,6}服务费|支付.{0,8}服务费用?|请.{0,8}(支付|缴纳).{0,6}(服务|费用)|付款用途|收款方|账户号码.{0,24}(converse|business[[:space:]]*tech))';
  neg_zh constant text :=
    '(未|没有|没|尚未|无法|还未|均未|暂未)[^。！？，、[:space:]]{0,4}?(提交|申报|报送|收到|接收|发送|寄出|支付|缴纳|付款|完成|提供|办理|发放)';
  paid_zh constant text :=
    '(已(付清|结清|支付|缴清|缴纳|还清)|付清了|无欠款|已无欠款|(欠款|债务)已(还清|清偿|结清))';
  call_zh constant text :=
    '(电话|致电|通话|来电|去电|打.{0,2}电话)';
  debt_req_zh constant text :=
    '(通知|提醒|催款|催缴|催收|请.{0,4}(支付|付款|缴纳|结清|还款))';
begin
  period_start := (((period_ym || '01')::date - interval '1 month' + interval '27 days')::timestamp
                   at time zone 'Asia/Yerevan');
  period_end   := (((period_ym || '01')::date + interval '27 days')::timestamp
                   at time zone 'Asia/Yerevan');

  with
  linked as (
    select c.agr_no,
           mqa_norm_tg_id(regexp_replace(c.chat_link, '^.*#', '')) as chat_key
    from mqa_chats c
    where c.status = 'Active'
      and c.chat_link is not null
      and regexp_replace(c.chat_link, '^.*#', '') ~ '^-?\d+$'
  ),
  msgs as (
    select l.agr_no,
           m.text,
           m.created_at
    from public.messages m
    join linked l on l.chat_key = mqa_norm_tg_id(m.chat_id::text)
    where m.sender_role = 'accountant'
      and m.created_at >= period_start
      and m.created_at <  period_end
      and m.text is not null
      and length(m.text) > 3
  ),
  signals as (
    select distinct agr_no, created_at, sig_cat, sig_type
    from msgs
    cross join lateral (
      values
        -- «\mготов» = «готов» at a word start (готово/готова), NOT «подготовки/
        -- подготовлен» (preparation) — the doc-request template «…корректной
        -- ПОДГОТОВКИ отчётности просим предоставить…» otherwise misfired as done.
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* '(отправ|подал|подан|сдан|направил|загрузил|выгрузил|сдала|отправила|отчита|задеклар|сдела|оформ|\mготов)'
               and text !~* neg_send
               and text !~* svc_pay
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* neg_send
              then 'main_taxes' end,
         'neg'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* '(получ|пришл|прислал|подпис|сдал|предоставил|скинул|сбросил|прислала|получила|пришла|передал|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|\mготов|выполн|оформ|провед|направ|перечисл|перевел|перевёл|переведен|простав|произвел|произвед)'
               and text !~* neg_done
               and text !~* neg_send
              then 'salary' end,
         'done'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансов)'
               and text ~* '(рассыл|разосл|разошл|уведомл|уведомил|уведомля|сообща|сообщил|сообщу|информир|напоминаем|напоминаю|напомнил|направля)'
               and text !~* neg_send
              then 'salary' end,
         'done'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M)'
               and text ~* '(запрос|прошу|просим|просят|просьб|нужн|пришлит|отправьт|скиньт|передайт|предоставьт|пожалуйст|жду|ожида)'
              then 'salary' end,
         'req'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_done
              then 'salary' end,
         'neg'),
        (case when text ~* '(зарплат|ведомост|заработн|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* neg_send
              then 'salary' end,
         'neg'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* '(получ|пришл|прислал|сдал|предоставил|скинул|передал|прислала|получила|пришла|отправил|отправила|отправлен|отправлена|отправили|выслал|переслал|сдела|сделан|\mготов|выполн|оформ|провед)'
               and text !~* neg_done
              then 'primary_docs' end,
         'done'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн)'
               and text ~* '(запрос|прошу|просим|просят|просьб|нужн|пришлит|отправьт|скиньт|передайт|предоставьт|пожалуйст|жду|ожида)'
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* neg_done
              then 'primary_docs' end,
         'neg'),
        (case when text ~* '(долг|задолженност|задолж)'
               and text ~* '(оплатил|оплатила|оплачен|оплачена|оплачено|оплата\s+прошла|выплатил|выплатила|погашен|погасил|закрыт|закрыта|нет\s+долга|нет\s+задолж)'
               and text !~* neg_paid
               and text !~* debt_notice
              then 'debts' end,
         'paid'),
        (case when text ~* '(долг|задолженност)'
               and text ~* '(позвон|звонил|звонок|обзвон|перезвон|созвон)'
              then 'debts' end,
         'call'),
        (case when text ~* '(долг|задолженност|задолж)'
               and text ~* '(напис|напомн|напомин|уведом|сообщ|информир|прос(им|ьб|ит)|оплатит|оплатите|погасит|к\s+оплате|рассыл|разосл|разошл)'
              then 'debts' end,
         'req'),
        (case when text ~* svc_pay
              then 'debts' end,
         'req'),
        (case when text ~* debt_soft_ru
               and text !~* neg_paid
               and text !~* neg_send
              then 'debts' end,
         'req'),

        (case when text ~* '(налог|декларац|ндс|налогов)'
               and text ~* mailing_ru
               and text !~* neg_send
               and text !~* svc_pay
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(зарплат|зарплн|заработн|ведомост|\mзп\M|авансовый\s+отчет|авансов)'
               and text ~* mailing_ru
               and text !~* neg_send
              then 'salary' end,
         'done'),
        (case when text ~* '(первичн|первичк|акт[ыа]?\M|документ|накладн|счет-факт|счёт-факт)'
               and text ~* mailing_ru
               and text !~* neg_done
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(долг|задолженност|задолж|недоимк)'
               and text ~* mailing_ru
              then 'debts' end,
         'req'),

        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* '(ուղարկ|ներկայաց|հանձնե|բեռնե|ներբեռն)'
               and text !~* neg_hy
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* neg_hy
              then 'main_taxes' end,
         'neg'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* '(ստաց|ուղարկ|տրամ|ստ\.)'
               and text !~* neg_hy
              then 'salary' end,
         'done'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* '(տեղեկացն|հիշեցն)'
               and text !~* neg_send_hy
              then 'salary' end,
         'done'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ռոճիկ)'
               and text ~* '(խնդրե|կարիք|պե՞տք)'
              then 'salary' end,
         'req'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* neg_hy
              then 'salary' end,
         'neg'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* '(ստաց|ուղարկ|հանձնե|ստ\.)'
               and text !~* neg_hy
              then 'primary_docs' end,
         'done'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ)'
               and text ~* '(խնդրե|կարիք|պետք)'
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* neg_hy
              then 'primary_docs' end,
         'neg'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(վճար|մարե|փակե|չկա\s+պ|պարտք\s+չ)'
               and text !~* neg_hy
              then 'debts' end,
         'paid'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(զանգ|զ\.)'
              then 'debts' end,
         'call'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* '(գր[եէ]|հուշ|տեղեկ|ծանուց)'
              then 'debts' end,
         'req'),
        (case when text ~* debt_soft_hy
               and text !~* neg_hy
              then 'debts' end,
         'req'),

        (case when text ~* '(հարկ|ԱԱՀ|հայտ|հռչ|հաշվետ)'
               and text ~* mailing_hy
               and text !~* neg_send_hy
              then 'main_taxes' end,
         'done'),
        (case when text ~* '(աշխատավարձ|աշխ\.?\s*վ|ա/վ|ա\.վ\.|հաշվ\.?\s*ց|ռոճիկ)'
               and text ~* mailing_hy
               and text !~* neg_send_hy
              then 'salary' end,
         'done'),
        (case when text ~* '(փաստաթ|[աՈ][կք]տ|հաշիվ|[աՈ][կք]ներ|ն[եա]ր[կք]ա)'
               and text ~* mailing_hy
               and text !~* neg_hy
              then 'primary_docs' end,
         'req'),
        (case when text ~* '(պարտք|պարտաբ)'
               and text ~* mailing_hy
              then 'debts' end,
         'req'),

        -- ---- Chinese (中文) — v16 ------------------------------------------
        (case when text ~* taxes_zh
               and text ~* done_tax_zh
               and text !~* neg_zh
               and text !~* svc_pay_zh
              then 'main_taxes' end,
         'done'),
        (case when text ~* taxes_zh
               and text ~* notify_zh
               and text !~* neg_zh
               and text !~* svc_pay_zh
              then 'main_taxes' end,
         'done'),
        (case when text ~* taxes_zh
               and text ~* neg_zh
              then 'main_taxes' end,
         'neg'),
        (case when text ~* salary_zh
               and text ~* done_recv_zh
               and text !~* neg_zh
              then 'salary' end,
         'done'),
        (case when text ~* salary_zh
               and text ~* notify_zh
               and text !~* neg_zh
              then 'salary' end,
         'done'),
        (case when text ~* salary_zh
               and text ~* req_zh
              then 'salary' end,
         'req'),
        (case when text ~* salary_zh
               and text ~* neg_zh
              then 'salary' end,
         'neg'),
        (case when text ~* primary_zh
               and text ~* done_recv_zh
               and text !~* neg_zh
              then 'primary_docs' end,
         'done'),
        (case when text ~* primary_zh
               and text ~* req_zh
              then 'primary_docs' end,
         'req'),
        (case when text ~* primary_zh
               and text ~* neg_zh
              then 'primary_docs' end,
         'neg'),
        (case when text ~* debts_zh
               and text ~* paid_zh
               and text !~* neg_zh
              then 'debts' end,
         'paid'),
        (case when text ~* debts_zh
               and text ~* call_zh
              then 'debts' end,
         'call'),
        (case when text ~* debts_zh
               and text ~* debt_req_zh
              then 'debts' end,
         'req'),
        (case when text ~* svc_pay_zh
              then 'debts' end,
         'req'),
        -- soft catch-all (parity with v12): a category keyword + a generic
        -- mailing/notification word identifies the рассылка type.
        (case when text ~* taxes_zh
               and text ~* mailing_zh
               and text !~* neg_zh
               and text !~* svc_pay_zh
              then 'main_taxes' end,
         'done'),
        (case when text ~* salary_zh
               and text ~* mailing_zh
               and text !~* neg_zh
              then 'salary' end,
         'done'),
        (case when text ~* primary_zh
               and text ~* mailing_zh
               and text !~* neg_zh
              then 'primary_docs' end,
         'req'),
        (case when text ~* debts_zh
               and text ~* mailing_zh
              then 'debts' end,
         'req')
    ) t(sig_cat, sig_type)
    where sig_cat is not null
  ),
  counts as (
    select agr_no,
           sig_cat as category,
           sig_type as stype,
           count(*)::int as n,
           max(created_at) as last_at
    from signals
    group by agr_no, sig_cat, sig_type
  ),
  pivoted as (
    select agr_no,
           category,
           coalesce(max(case when stype = 'done' then n end), 0) as done_n,
           coalesce(max(case when stype = 'req'  then n end), 0) as req_n,
           coalesce(max(case when stype = 'call' then n end), 0) as call_n,
           coalesce(max(case when stype = 'paid' then n end), 0) as paid_n,
           coalesce(max(case when stype = 'neg'  then n end), 0) as neg_n,
           greatest(
             max(case when stype = 'done' then last_at end),
             max(case when stype = 'req'  then last_at end),
             max(case when stype = 'call' then last_at end),
             max(case when stype = 'paid' then last_at end),
             max(case when stype = 'neg'  then last_at end)
           ) as detected_at
    from counts
    group by agr_no, category
  ),
  final as (
    select agr_no,
           category,
           case category
             when 'main_taxes' then
               case when done_n >= 1 then 'Отправил'
                    when neg_n  >= 1 then 'Не отправил'
               end
             when 'salary' then
               case when done_n >= 1 then 'Получил'
                    when req_n  >= 2 then 'Запросил 2, не получил'
                    when req_n  =  1 then 'Запросил 1, не получил'
                    when neg_n  >= 1 then 'Запросил 1, не получил'
               end
             when 'primary_docs' then
               case when done_n >= 1 then 'Получил'
                    when req_n  >= 2 then 'Запросил 2, не получил'
                    when req_n  =  1 then 'Запросил 1, не получил'
                    when neg_n  >= 1 then 'Запросил 1, не получил'
               end
             when 'debts' then
               case when paid_n >= 1 then 'Нет долга'
                    when call_n >= 1 then '1-й позвонил'
                    when req_n  >= 2 then '2-й написал'
                    when req_n  =  1 then '1-й написал'
               end
           end as status,
           detected_at
    from pivoted
  )
  insert into mqa_chat_mailings
         (agr_no, period, category, status, source, detected_at, updated_at)
  select  agr_no, period_ym, category, status, 'telegram', detected_at, now()
  from    final
  where   status is not null
  on conflict (agr_no, period, category) do update
    set status      = excluded.status,
        detected_at = excluded.detected_at,
        updated_at  = now()
    where mqa_chat_mailings.source <> 'manual';
end;
$function$;
