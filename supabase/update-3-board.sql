-- 아침 영어 뉴스 클럽: 업데이트 3 (회원끼리 달별·이번 주 학습 현황 보기)
-- update-2-push.sql 다음에 한 번만 실행하세요. 여러 번 실행해도 안전합니다.
-- 회원은 다른 회원의 이름, 단계, 이번 달·이번 주 접속일, 끝까지 들은 브리핑 수, 연속 접속일만 볼 수 있습니다.
-- 접속 코드, 단어 조회 기록, 알림 설정은 보이지 않습니다.

-- 연속 접속일 (오늘 아직 안 들어왔으면 어제부터 셉니다)
create or replace function public._streak(p_member uuid) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
declare d date := public._kst_today(); n int := 0;
begin
  if not exists (select 1 from public.visits where member_id = p_member and day = d) then d := d - 1; end if;
  while exists (select 1 from public.visits where member_id = p_member and day = d) loop
    n := n + 1; d := d - 1;
  end loop;
  return n;
end $$;

-- 이번 달(1일~말일)과 이번 주(월~일, 한국 시간) 함께 보기
create or replace function public.club_board(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members; today date := public._kst_today(); wk date; mo date;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  wk := date_trunc('week', today)::date;
  mo := date_trunc('month', today)::date;
  return json_build_object(
    'today', today,
    'week_start', wk,
    'month_start', mo,
    'members', (
      select coalesce(json_agg(r order by r.month_done desc, r.month_days desc, r.streak desc, r.name), '[]'::json) from (
        select mb.name, mb.level, (mb.id = m.id) as is_me,
          (select count(*) from public.visits v where v.member_id = mb.id and v.day >= mo) as month_days,
          (select count(distinct e.briefing_id) from public.events e
            where e.member_id = mb.id and e.kind = 'complete' and (e.at at time zone 'Asia/Seoul')::date >= mo) as month_done,
          (select count(*) from public.visits v where v.member_id = mb.id and v.day >= wk) as week_days,
          (select coalesce(json_agg(v.day order by v.day), '[]'::json) from public.visits v where v.member_id = mb.id and v.day >= wk) as week_visits,
          (select count(distinct e.briefing_id) from public.events e
            where e.member_id = mb.id and e.kind = 'complete' and (e.at at time zone 'Asia/Seoul')::date >= wk) as week_done,
          (select count(distinct e.briefing_id) from public.events e
            where e.member_id = mb.id and e.kind = 'complete' and (e.at at time zone 'Asia/Seoul')::date = today) as today_done,
          exists (select 1 from public.visits v where v.member_id = mb.id and v.day = today) as today_visit,
          (select count(distinct e.briefing_id) from public.events e where e.member_id = mb.id and e.kind = 'complete') as total_done,
          public._streak(mb.id) as streak
        from public.members mb
        where mb.active
      ) r
    )
  );
end $$;

-- 달별로 보기: p_month = 'YYYY-MM' (비우면 이번 달). 지난 달은 그 달의 최종 기록입니다.
create or replace function public.club_board_month(p_code text, p_month text default null) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members; today date := public._kst_today(); mo date; nx date; cur boolean;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  if p_month is null or p_month = '' then mo := date_trunc('month', today)::date;
  elsif p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then mo := (p_month || '-01')::date;
  else raise exception 'bad_month'; end if;
  if mo > today then mo := date_trunc('month', today)::date; end if;
  nx := (mo + interval '1 month')::date;
  cur := today < nx;
  return json_build_object(
    'month_start', mo,
    'days_in_month', nx - mo,
    'elapsed', case when cur then today - mo + 1 else nx - mo end,
    'is_current', cur,
    'today', today,
    'first_month', (select to_char(min(day), 'YYYY-MM') from public.visits),
    'members', (
      select coalesce(json_agg(r order by r.done desc, r.days desc, r.name), '[]'::json) from (
        select mb.name, mb.level, (mb.id = m.id) as is_me,
          (select count(*) from public.visits v where v.member_id = mb.id and v.day >= mo and v.day < nx) as days,
          (select count(distinct e.briefing_id) from public.events e
            where e.member_id = mb.id and e.kind = 'complete'
              and (e.at at time zone 'Asia/Seoul')::date >= mo and (e.at at time zone 'Asia/Seoul')::date < nx) as done,
          case when cur then (select count(distinct e.briefing_id) from public.events e
            where e.member_id = mb.id and e.kind = 'complete' and (e.at at time zone 'Asia/Seoul')::date = today) else 0 end as today_done,
          (cur and exists (select 1 from public.visits v where v.member_id = mb.id and v.day = today)) as today_visit,
          case when cur then public._streak(mb.id) else 0 end as streak
        from public.members mb
        where mb.active
      ) r
    )
  );
end $$;

revoke execute on function public._streak(uuid) from public, anon, authenticated;
revoke execute on function public.club_board(text) from public, authenticated;
grant execute on function public.club_board(text) to anon;
revoke execute on function public.club_board_month(text, text) from public, authenticated;
grant execute on function public.club_board_month(text, text) to anon;

select '업데이트 완료: 회원끼리 달별·이번 주 학습 현황 보기' as "결과";
