-- 아침 영어 뉴스 클럽: 업데이트 1 (회원별 난이도 1~5단계)
-- 이미 setup.sql을 실행한 프로젝트에서 한 번만 실행하세요. 여러 번 실행해도 안전합니다.
-- Supabase 대시보드 > SQL Editor > New query에 이 파일 전체를 붙여넣고 Run을 누르세요.

-- 회원이 고른 단계 (아직 고르지 않았으면 비어 있음)
alter table public.members add column if not exists level smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_level_check') then
    alter table public.members add constraint members_level_check check (level between 1 and 5);
  end if;
end $$;

-- 로그인할 때 단계도 함께 돌려줍니다.
create or replace function public.club_login(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  insert into public.visits(member_id, day) values (m.id, public._kst_today()) on conflict do nothing;
  return json_build_object('name', m.name, 'is_admin', m.is_admin, 'level', m.level);
end $$;

-- 회원이 자기 단계를 고르거나 바꿉니다.
create or replace function public.club_set_level(p_code text, p_level int) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members;
begin
  if p_level is null or p_level not between 1 and 5 then raise exception 'bad_level'; end if;
  m := public._member(p_code);
  if m.id is null then return false; end if;
  update public.members set level = p_level where id = m.id;
  return true;
end $$;

-- 관리자 회원 목록에 단계를 더합니다.
create or replace function public.club_admin_members(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  perform public._admin(p_code);
  return (
    select coalesce(json_agg(r order by r.last_visit desc nulls last, r.name), '[]'::json) from (
      select mb.id, mb.name, mb.is_admin, mb.active, mb.created_at, mb.level,
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

revoke execute on function public.club_set_level(text, int) from public, anon, authenticated;
grant execute on function public.club_set_level(text, int) to anon;

select '업데이트 완료: 회원별 난이도 저장' as "결과";
