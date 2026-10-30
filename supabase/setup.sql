-- 아침 영어 뉴스 클럽: Supabase 설정
-- Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여넣고 Run을 누르세요.
-- 마지막 줄의 '관리자 이름'을 본인 이름으로 바꾼 뒤 실행하면, 결과 칸에 관리자 접속 코드가 나옵니다.

create extension if not exists pgcrypto with schema extensions;

-- 1. 테이블 -------------------------------------------------------------

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code_hash   text not null,
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.visits (
  member_id   uuid not null references public.members(id) on delete cascade,
  day         date not null,
  first_at    timestamptz not null default now(),
  primary key (member_id, day)
);

create table if not exists public.events (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  briefing_id text not null,
  kind        text not null check (kind in ('play','complete','script','translation','words','lookup')),
  detail      text,
  at          timestamptz not null default now()
);
create index if not exists events_member_idx on public.events(member_id, at desc);

create table if not exists public.login_failures (
  id   bigint generated always as identity primary key,
  at   timestamptz not null default now()
);

-- 앱은 테이블에 직접 접근하지 못하고, 아래 함수로만 읽고 씁니다.
alter table public.members        enable row level security;
alter table public.visits         enable row level security;
alter table public.events         enable row level security;
alter table public.login_failures enable row level security;
revoke all on public.members, public.visits, public.events, public.login_failures from anon, authenticated;

-- 2. 내부 도우미 ---------------------------------------------------------

create or replace function public._kst_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function public._new_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_code text := '';
  i int;
begin
  for i in 1..8 loop
    out_code := out_code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
  end loop;
  return out_code;
end $$;

-- 코드로 회원 찾기. 최근 10분 동안 실패가 50번을 넘으면 잠시 막습니다(무작위 대입 방지).
create or replace function public._member(p_code text) returns public.members
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  if (select count(*) from public.login_failures where at > now() - interval '10 minutes') > 50 then
    raise exception 'too_many_attempts';
  end if;
  select * into m from public.members
   where active and code_hash = crypt(upper(trim(p_code)), code_hash) limit 1;
  if m.id is null then
    insert into public.login_failures default values;
    delete from public.login_failures where at < now() - interval '1 day';
  end if;
  return m;
end $$;

create or replace function public._admin(p_code text) returns public.members
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null or not m.is_admin then raise exception 'not_admin'; end if;
  return m;
end $$;

-- 3. 회원용 함수 ---------------------------------------------------------

-- 로그인(앱을 열 때마다 호출): 오늘 접속일을 기록하고 이름을 돌려줍니다.
create or replace function public.club_login(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  insert into public.visits(member_id, day) values (m.id, public._kst_today()) on conflict do nothing;
  return json_build_object('name', m.name, 'is_admin', m.is_admin);
end $$;

-- 학습 기록 남기기
create or replace function public.club_log(p_code text, p_briefing text, p_kind text, p_detail text default null) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null then return false; end if;
  insert into public.visits(member_id, day) values (m.id, public._kst_today()) on conflict do nothing;
  insert into public.events(member_id, briefing_id, kind, detail)
  values (m.id, left(p_briefing, 40), p_kind, left(p_detail, 80));
  return true;
end $$;

-- 내 기록
create or replace function public.club_my_stats(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  m public.members;
  streak int := 0;
  d date := public._kst_today();
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  if not exists (select 1 from public.visits where member_id = m.id and day = d) then d := d - 1; end if;
  while exists (select 1 from public.visits where member_id = m.id and day = d) loop
    streak := streak + 1; d := d - 1;
  end loop;
  return json_build_object(
    'name', m.name,
    'streak', streak,
    'days_total', (select count(*) from public.visits where member_id = m.id),
    'days_30', (select count(*) from public.visits where member_id = m.id and day > public._kst_today() - 30),
    'visit_days', (select coalesce(json_agg(day order by day), '[]'::json) from public.visits where member_id = m.id and day > public._kst_today() - 35),
    'played', (select count(distinct briefing_id) from public.events where member_id = m.id and kind = 'play'),
    'completed', (select coalesce(json_agg(distinct briefing_id), '[]'::json) from public.events where member_id = m.id and kind = 'complete'),
    'lookups', (select count(*) from public.events where member_id = m.id and kind = 'lookup')
  );
end $$;

-- 4. 관리자용 함수 -------------------------------------------------------

create or replace function public.club_admin_members(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  perform public._admin(p_code);
  return (
    select coalesce(json_agg(r order by r.last_visit desc nulls last, r.name), '[]'::json) from (
      select mb.id, mb.name, mb.is_admin, mb.active, mb.created_at,
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

create or replace function public.club_admin_add_member(p_code text, p_name text, p_is_admin boolean default false) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare new_code text := public._new_code(); new_id uuid;
begin
  perform public._admin(p_code);
  insert into public.members(name, code_hash, is_admin)
  values (left(trim(p_name), 40), crypt(new_code, gen_salt('bf', 8)), coalesce(p_is_admin, false))
  returning id into new_id;
  return json_build_object('id', new_id, 'code', new_code);
end $$;

create or replace function public.club_admin_reset_code(p_code text, p_member uuid) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare new_code text := public._new_code();
begin
  perform public._admin(p_code);
  update public.members set code_hash = crypt(new_code, gen_salt('bf', 8)) where id = p_member;
  return new_code;
end $$;

create or replace function public.club_admin_set_active(p_code text, p_member uuid, p_active boolean) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me public.members;
begin
  me := public._admin(p_code);
  if me.id = p_member then raise exception 'cannot_change_self'; end if;
  update public.members set active = p_active where id = p_member;
  return true;
end $$;

-- 5. 권한: 앱(anon)은 club_ 함수만 부를 수 있습니다 ------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.club_login(text) to anon;
grant execute on function public.club_log(text, text, text, text) to anon;
grant execute on function public.club_my_stats(text) to anon;
grant execute on function public.club_admin_members(text) to anon;
grant execute on function public.club_admin_add_member(text, text, boolean) to anon;
grant execute on function public.club_admin_reset_code(text, uuid) to anon;
grant execute on function public.club_admin_set_active(text, uuid, boolean) to anon;

-- 6. 첫 관리자 만들기 (처음 한 번만) ---------------------------------------
-- 회원이 한 명도 없을 때만 동작합니다. 결과 칸에 나오는 코드가 관리자 접속 코드입니다.

create or replace function public.create_first_admin(p_name text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare new_code text := public._new_code();
begin
  if exists (select 1 from public.members) then raise exception 'members_already_exist'; end if;
  insert into public.members(name, code_hash, is_admin) values (p_name, crypt(new_code, gen_salt('bf', 8)), true);
  return new_code;
end $$;
revoke execute on function public.create_first_admin(text) from public, anon, authenticated;

select public.create_first_admin('관리자 이름') as "관리자 접속 코드";
