-- ---------------------------------------------------------------------------
-- Маргарита: остальные «пропавшие» чаты добавлены по присланным данным.
-- № договора / имя / бухгалтер / ответственный менеджер получены от клиента.
-- Текст (армянский/русский) закодирован base64 и раскодируется convert_from,
-- чтобы гарантировать корректные байты. Бухгалтеры сопоставлены с mqa_accountants.
-- on conflict do nothing → идемпотентно; синк неразрушающий и manager/chat_link
-- не пишет, поэтому записи сохранятся. head accountant у всех — Эмилия (глобально).
-- ---------------------------------------------------------------------------

-- 9 новых чатов (B-4859 уже существовал с пустой ссылкой — обновлён ниже).
insert into mqa_chats (agr_no, chat_name, chat_link, accountant, manager, status)
values
  (convert_from(decode('0JItNDgwMQ==','base64'),'UTF8'),convert_from(decode('0JItNDgwMSDQmNCfINCt0LvRjNCy0LjRgNCwINCt0YDRiNC70LXRgCBSVQ==','base64'),'UTF8'),'https://web.telegram.org/a/#-5143986020',convert_from(decode('1LzVq9Ws1avVqQ==','base64'),'UTF8'),'manager_onebusiness','Active'),
  (convert_from(decode('Qi00ODY5','base64'),'UTF8'),convert_from(decode('Qi00ODY5IDzUtdaA1aHVptWh1bbWhCDVhtWh1a3VodWv1oDVqdWh1oDVodW2PiDVjdWK1LggQU0=','base64'),'UTF8'),'https://web.telegram.org/a/#-5499648775',convert_from(decode('1ZXVrNW11aE=','base64'),'UTF8'),'manager_onebusiness and shogher','Active'),
  (convert_from(decode('Qi00ODY4','base64'),'UTF8'),convert_from(decode('Qi00ODY4IDzQkdCw0YAg0JPQsNGA0LPRg9C70YzRjz4g0J7QntCeIFJV','base64'),'UTF8'),'https://web.telegram.org/a/#-5540981985',convert_from(decode('1LHWgNWp1bjWgtaA','base64'),'UTF8'),'manager_onebusiness and shogher','Active'),
  (convert_from(decode('Qi00ODU5','base64'),'UTF8'),convert_from(decode('Qi00ODU5IDzVj9Wl1oDWgNWh1oTVuNaAINWN1bjWgtWs1bXVuNaC1bfVttW9PiDVjdWK1LggQU0=','base64'),'UTF8'),'https://web.telegram.org/a/#-5571805440',convert_from(decode('1LTVodW+1avVqQ==','base64'),'UTF8'),'manager_onebusiness and shogher','Active'),
  (convert_from(decode('Qi00ODQ3','base64'),'UTF8'),convert_from(decode('Qi00ODQ3INCY0J8g0JTQvNC40YLRgNC40Lkg0JTQvtCx0YDRj9C90YHQutC40LkgUlU=','base64'),'UTF8'),'https://web.telegram.org/a/#-5467648106',convert_from(decode('1LzVq9Ws1avVqQ==','base64'),'UTF8'),'manager_onebusiness','Active'),
  (convert_from(decode('Qi00ODMy','base64'),'UTF8'),convert_from(decode('Qi00ODMyINWN1YrUuCDVjdWl1aPVodaA1bTVoSBBTQ==','base64'),'UTF8'),'https://web.telegram.org/a/#-5440725671',convert_from(decode('1LTVodW+1avVqQ==','base64'),'UTF8'),'manager_onebusiness','Active'),
  (convert_from(decode('Qi00ODA2','base64'),'UTF8'),convert_from(decode('Qi00ODA2IDzQmNCz0L7RgNGMINCT0YDQuNCz0L7RgNGM0LXQsiDQntC70LXQs9C+0LLQuNGHPiDQmNCfIFJV','base64'),'UTF8'),'https://web.telegram.org/a/#-5499312183',convert_from(decode('1YzVuNWi1aXWgNW/','base64'),'UTF8'),'manager_onebusiness and shogher','Active'),
  (convert_from(decode('Qi00Nzc0','base64'),'UTF8'),convert_from(decode('Qi00Nzc0IDxDYXIgSHVudGVyIFNhbGU+IExMQyBFTkc=','base64'),'UTF8'),'https://web.telegram.org/a/#-5109390982',convert_from(decode('1ZXVrNW11aE=','base64'),'UTF8'),'manager_onebusiness and shogher','Active'),
  (convert_from(decode('Qi00ODQz','base64'),'UTF8'),convert_from(decode('Qi00ODQzIDxIdWFtZWlhIEJlYXV0eT4gTExDIEVORw==','base64'),'UTF8'),'https://web.telegram.org/a/#-5263769360',convert_from(decode('1LTVodW+1avVqQ==','base64'),'UTF8'),'manager_onebusiness and shogher','Active')
on conflict (agr_no) do nothing;
-- Ответственный менеджер для 3 ранее добавленных чатов.
update mqa_chats c set manager = v.manager
from (values
  (convert_from(decode('0JItNDIxNg==','base64'),'UTF8'),'manager_onebusiness'),
  (convert_from(decode('Qi0zMzAy','base64'),'UTF8'),'manager_onebusiness'),
  (convert_from(decode('Qi0zNjA5','base64'),'UTF8'),'manager_onebusiness and shogher')
) as v(agr_no, manager)
where c.agr_no = v.agr_no;
-- B-4859 уже был в базе без chat_link/manager — дозаполняем.
update mqa_chats
set chat_link = 'https://web.telegram.org/a/#-5571805440',
    manager = 'manager_onebusiness and shogher'
where agr_no = 'B-4859';
