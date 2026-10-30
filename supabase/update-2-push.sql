-- 아침 영어 뉴스 클럽: 업데이트 2 (매일 앱 알림)
-- update-1-levels.sql 다음에 한 번만 실행하세요. 여러 번 실행해도 안전합니다.
-- 알림을 보내는 열쇠(VAPID 키)와 비밀값은 이 파일에 없습니다. 관리자에게 따로 받은 짧은 SQL로 넣습니다.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 1. 저장 공간 ------------------------------------------------------------

-- 회원별 알림 시간(기본 06:40)과 시험 알림 요청 시각
alter table public.members add column if not exists notify_time time not null default '06:40';
alter table public.members add column if not exists push_test_at timestamptz;

-- 알림을 켠 기기(휴대폰 브라우저)마다 한 줄
create table if not exists public.push_subs (
  endpoint    text primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  device      text,
  created_at  timestamptz not null default now(),
  last_sent   date,
  last_ok     timestamptz,
  fails       int not null default 0
);
create index if not exists push_subs_member_idx on public.push_subs(member_id);

-- 알림 발송 설정(한 줄): VAPID 키, 발송 함수 주소, 발송 비밀값
create table if not exists public.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_x       text,
  vapid_y       text,
  vapid_d       text,
  subject       text,
  function_url  text,
  cron_secret   text
);

alter table public.push_subs   enable row level security;
alter table public.push_config enable row level security;
revoke all on public.push_subs, public.push_config from anon, authenticated;

-- 2. 회원용 함수 (접속 코드로 확인) ------------------------------------------

create or replace function public.club_login(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  insert into public.visits(member_id, day) values (m.id, public._kst_today()) on conflict do nothing;
  return json_build_object('name', m.name, 'is_admin', m.is_admin, 'level', m.level,
                           'notify_time', to_char(m.notify_time, 'HH24:MI'));
end $$;

-- 이 기기에서 알림 켜기 (같은 기기로 다른 회원이 켜면 그 회원으로 바뀝니다)
create or replace function public.club_push_subscribe(p_code text, p_endpoint text, p_p256dh text, p_auth text, p_device text default null) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null then return false; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'bad_subscription';
  end if;
  insert into public.push_subs(endpoint, member_id, p256dh, auth, device)
  values (p_endpoint, m.id, p_p256dh, p_auth, left(p_device, 60))
  on conflict (endpoint) do update
    set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device = excluded.device, fails = 0;
  return true;
end $$;

-- 이 기기에서 알림 끄기
create or replace function public.club_push_unsubscribe(p_code text, p_endpoint text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null then return false; end if;
  delete from public.push_subs where endpoint = p_endpoint and member_id = m.id;
  return true;
end $$;

-- 알림 시간 바꾸기 ('HH:MM', 한국 시간)
create or replace function public.club_set_notify_time(p_code text, p_time text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members; t time;
begin
  if p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'bad_time'; end if;
  t := p_time::time;
  m := public._member(p_code);
  if m.id is null then return null; end if;
  update public.members set notify_time = t where id = m.id;
  -- 오늘 알림이 이미 갔더라도, 새 시간이 아직 안 지났으면 오늘 한 번 더 받을 수 있게 합니다.
  if t > (now() at time zone 'Asia/Seoul')::time then
    update public.push_subs set last_sent = null where member_id = m.id;
  end if;
  return to_char(t, 'HH24:MI');
end $$;

-- 시험 알림 요청: 1분 안에 이 회원의 모든 기기로 보냅니다. 알림을 켠 기기 수를 돌려줍니다.
create or replace function public.club_push_test(p_code text) returns int
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members; n int;
begin
  m := public._member(p_code);
  if m.id is null then return -1; end if;
  select count(*) into n from public.push_subs where member_id = m.id;
  if n > 0 then update public.members set push_test_at = now() where id = m.id; end if;
  return n;
end $$;

-- 3. 발송 (매분 확인, 보낼 게 있을 때만 발송 함수 호출) ---------------------------

-- 지금 보낼 알림 목록. p_ready = 오늘 뉴스가 올라왔는지. 아직이면 알림 시간 뒤 최대 60분까지 기다립니다.
create or replace function public._push_due_rows(p_ready boolean)
returns table(endpoint text, p256dh text, auth text, kind text, notify_time text)
language sql stable security definer set search_path = public, extensions as $$
  with now_kst as (select (now() at time zone 'Asia/Seoul') as ts)
  select s.endpoint, s.p256dh, s.auth, 'daily', to_char(m.notify_time, 'HH24:MI')
    from public.push_subs s join public.members m on m.id = s.member_id, now_kst n
   where m.active
     and (s.last_sent is null or s.last_sent < n.ts::date)
     and n.ts::time >= m.notify_time
     and n.ts::time - m.notify_time < interval '3 hours'
     and (p_ready or n.ts::time - m.notify_time >= interval '60 minutes')
  union all
  select s.endpoint, s.p256dh, s.auth, 'test', to_char(m.notify_time, 'HH24:MI')
    from public.push_subs s join public.members m on m.id = s.member_id
   where m.active and m.push_test_at > now() - interval '10 minutes'
$$;

-- 매분 실행: 보낼 알림이 있으면 발송 함수를 부릅니다.
create or replace function public._push_tick() returns void
language plpgsql volatile security definer set search_path = public, extensions as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if c.function_url is null or c.cron_secret is null then return; end if;
  if not exists (select 1 from public._push_due_rows(true)) then return; end if;
  perform net.http_post(
    url := c.function_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.cron_secret),
    timeout_milliseconds := 30000);
end $$;

-- 발송 함수가 부르는 함수: 비밀값이 맞을 때만 보낼 목록과 키를 주고, 보냈다고 표시합니다.
create or replace function public.club_push_due(p_secret text, p_ready boolean) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare c public.push_config; rows json;
begin
  select * into c from public.push_config where id = 1;
  if c.cron_secret is null or p_secret is distinct from c.cron_secret then raise exception 'forbidden'; end if;
  select coalesce(json_agg(r), '[]'::json) into rows from public._push_due_rows(p_ready) r;
  update public.push_subs s set last_sent = (now() at time zone 'Asia/Seoul')::date
   where s.endpoint in (select d.endpoint from public._push_due_rows(p_ready) d where d.kind = 'daily');
  update public.members set push_test_at = null where push_test_at <= now();
  return json_build_object(
    'vapid', json_build_object('public', c.vapid_public, 'x', c.vapid_x, 'y', c.vapid_y, 'd', c.vapid_d, 'subject', c.subject),
    'items', rows);
end $$;

-- 발송 결과 기록: 없어진 기기(404, 410)는 지우고, 일시적 실패는 다음 분에 다시 보냅니다.
create or replace function public.club_push_report(p_secret text, p_results json) returns int
language plpgsql volatile security definer set search_path = public, extensions as $$
declare c public.push_config; r json; st int; n int := 0;
begin
  select * into c from public.push_config where id = 1;
  if c.cron_secret is null or p_secret is distinct from c.cron_secret then raise exception 'forbidden'; end if;
  for r in select * from json_array_elements(p_results) loop
    st := coalesce((r->>'status')::int, 0);
    if st in (404, 410) then
      delete from public.push_subs where endpoint = r->>'endpoint';
    elsif st between 200 and 299 then
      update public.push_subs set last_ok = now(), fails = 0 where endpoint = r->>'endpoint';
    else
      update public.push_subs
         set fails = fails + 1,
             last_sent = case when r->>'kind' = 'daily' and fails < 3 then null else last_sent end
       where endpoint = r->>'endpoint';
      delete from public.push_subs where endpoint = r->>'endpoint' and fails >= 20;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 4. 관리자 목록에 알림 정보 추가 -------------------------------------------

create or replace function public.club_admin_members(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  perform public._admin(p_code);
  return (
    select coalesce(json_agg(r order by r.last_visit desc nulls last, r.name), '[]'::json) from (
      select mb.id, mb.name, mb.is_admin, mb.active, mb.created_at, mb.level,
        to_char(mb.notify_time, 'HH24:MI') as notify_time,
        (select count(*) from public.push_subs ps where ps.member_id = mb.id) as push_devices,
        (select max(day) from public.visits v where v.member_id = mb.id) as last_visit,
        (select count(*) from public.visits v where v.member_id = mb.id and v.day > public._kst_today() - 30) as days_30,
        (select count(*) from public.visits v where v.member_id = mb.id) as days_total,
        (select coalesce(json_agg(v.day order by v.day), '[]'::json) from public.visits v where v.member_id = mb.id and v.day > public._kst_today() - 14) as recent_days,
        (select count(distinct briefing_id) from public.events e where e.member_id = mb.id and e.kind = 'play') as played,
        (select count(distinct briefing_id) from public.events e where e.member_id = mb.id and e.kind = 'complete') as completed,
        (select count(*) from public.events e where e.member_id = mb.id and e.kind = 'lookup') as lookups
      from public.members mb
    ) r
  );
end $$;

-- 5. 권한 ---------------------------------------------------------------

revoke execute on function public._push_due_rows(boolean), public._push_tick() from public, anon, authenticated;
revoke execute on function public.club_push_subscribe(text, text, text, text, text), public.club_push_unsubscribe(text, text),
  public.club_set_notify_time(text, text), public.club_push_test(text), public.club_push_due(text, boolean),
  public.club_push_report(text, json) from public, authenticated;
grant execute on function public.club_push_subscribe(text, text, text, text, text) to anon;
grant execute on function public.club_push_unsubscribe(text, text) to anon;
grant execute on function public.club_set_notify_time(text, text) to anon;
grant execute on function public.club_push_test(text) to anon;
grant execute on function public.club_push_due(text, boolean) to anon;
grant execute on function public.club_push_report(text, json) to anon;

-- 6. 매분 확인 예약과, 예약 실행 기록 정리(7일 보관) ----------------------------

select cron.schedule('club-push-tick', '* * * * *', 'select public._push_tick()');
select cron.schedule('club-cron-cleanup', '17 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

select '업데이트 완료: 매일 앱 알림 (발송 키는 아직 넣지 않음)' as "결과";
