-- 아침 영어 뉴스 클럽: 업데이트 4 (점수 · 주간 목표 · 동아리 공동 목표 · 레벨)
-- update-3-board.sql 다음에 한 번만 실행하세요. 여러 번 실행해도 안전합니다.
--
-- 하루 점수 (회원마다, 한국 시간 하루 기준, 하루 최대 10점)
--   접속하면 1점
--   그날 처음 끝까지 들은 뉴스 +3점, 두 번째·세 번째로 끝까지 들은 다른 뉴스 +2점씩
--   그 뒤로는 같은 뉴스 다시 듣기, 네 번째 뉴스, 뽀로로 영상(끝까지 보기) 1번에 +1점씩
-- 지난 기록도 이 방식으로 다시 계산됩니다. 예전에는 반복 듣기와 뽀로로를 기록하지 않았으므로 그 몫은 없습니다.

-- 뽀로로 영상을 끝까지 본 기록(video)도 남길 수 있게 합니다.
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check
  check (kind in ('play', 'complete', 'script', 'translation', 'words', 'lookup', 'video'));
-- 회원별·날짜별 점수를 빨리 계산하도록 색인을 둡니다.
create index if not exists events_member_kind_at on public.events(member_id, kind, at);

-- 회원별·날짜별 점수
create or replace function public._day_points(p_from date, p_to date)
returns table(member_id uuid, day date, pts int)
language sql stable security definer set search_path = public, extensions as $$
  with ev as (
    select e.member_id, (e.at at time zone 'Asia/Seoul')::date as day,
           count(*) filter (where e.kind = 'complete') as n_all,
           count(distinct e.briefing_id) filter (where e.kind = 'complete') as n_dist,
           count(*) filter (where e.kind = 'video') as n_vid
    from public.events e
    where e.kind in ('complete', 'video')
      and (e.at at time zone 'Asia/Seoul')::date between p_from and p_to
    group by 1, 2
  )
  select v.member_id, v.day,
         least(10,
           1
           + case when coalesce(ev.n_dist, 0) >= 1 then 3 + 2 * (least(ev.n_dist, 3) - 1) else 0 end
           + greatest(coalesce(ev.n_all, 0) - least(coalesce(ev.n_dist, 0), 3), 0)
           + coalesce(ev.n_vid, 0)
         )::int as pts
  from public.visits v
  left join ev on ev.member_id = v.member_id and ev.day = v.day
  where v.day between p_from and p_to
$$;

-- 이번 주(월~일): 점수, 주간 목표(20점), 동아리 공동 목표(회원 1명당 15점), 지난주 같은 때 점수, 누적 점수(레벨용)
create or replace function public.club_board(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members; today date := public._kst_today(); wk date; mo date; n int;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  wk := date_trunc('week', today)::date;
  mo := date_trunc('month', today)::date;
  select count(*) into n from public.members where active;
  return (
    with wp as (select x.member_id, sum(x.pts)::int as pts from public._day_points(wk, today) x group by 1),
         pp as (select x.member_id, sum(x.pts)::int as pts from public._day_points(wk - 7, today - 7) x group by 1),
         tp as (select x.member_id, sum(x.pts)::int as pts from public._day_points('2000-01-01', today) x group by 1),
         dp as (select x.member_id, x.pts from public._day_points(today, today) x),
         r as (
           select mb.name, mb.level, (mb.id = m.id) as is_me,
             coalesce(wp.pts, 0) as week_points,
             coalesce(pp.pts, 0) as prev_points,
             coalesce(tp.pts, 0) as total_points,
             coalesce(dp.pts, 0) as today_points,
             (select count(*) from public.visits v where v.member_id = mb.id and v.day >= wk)::int as week_days,
             (select coalesce(json_agg(v.day order by v.day), '[]'::json) from public.visits v where v.member_id = mb.id and v.day >= wk) as week_visits,
             (select count(*) from public.events e where e.member_id = mb.id and e.kind = 'complete' and (e.at at time zone 'Asia/Seoul')::date >= wk)::int as week_done,
             (select count(*) from public.events e where e.member_id = mb.id and e.kind = 'video' and (e.at at time zone 'Asia/Seoul')::date >= wk)::int as week_videos,
             (select count(*) from public.events e where e.member_id = mb.id and e.kind = 'complete' and (e.at at time zone 'Asia/Seoul')::date = today)::int as today_done,
             exists (select 1 from public.visits v where v.member_id = mb.id and v.day = today) as today_visit,
             public._streak(mb.id) as streak
           from public.members mb
           left join wp on wp.member_id = mb.id
           left join pp on pp.member_id = mb.id
           left join tp on tp.member_id = mb.id
           left join dp on dp.member_id = mb.id
           where mb.active
         )
    select json_build_object(
      'today', today,
      'week_start', wk,
      'month_start', mo,
      'goal', 20,
      'club_goal', 15 * n,
      'club_points', (select coalesce(sum(r.week_points), 0) from r),
      'members', (select coalesce(json_agg(r order by r.week_points desc, r.week_days desc, r.streak desc, r.name), '[]'::json) from r)
    )
  );
end $$;

-- 달별: 점수 순위 (p_month = 'YYYY-MM', 비우면 이번 달)
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
  return (
    with mp as (select x.member_id, sum(x.pts)::int as pts from public._day_points(mo, nx - 1) x group by 1),
         tp as (select x.member_id, sum(x.pts)::int as pts from public._day_points('2000-01-01', today) x group by 1),
         r as (
           select mb.name, mb.level, (mb.id = m.id) as is_me,
             coalesce(mp.pts, 0) as points,
             coalesce(tp.pts, 0) as total_points,
             (select count(*) from public.visits v where v.member_id = mb.id and v.day >= mo and v.day < nx)::int as days,
             (select count(*) from public.events e where e.member_id = mb.id and e.kind = 'complete'
               and (e.at at time zone 'Asia/Seoul')::date >= mo and (e.at at time zone 'Asia/Seoul')::date < nx)::int as done,
             case when cur then (select count(*) from public.events e where e.member_id = mb.id and e.kind = 'complete'
               and (e.at at time zone 'Asia/Seoul')::date = today) else 0 end::int as today_done,
             (cur and exists (select 1 from public.visits v where v.member_id = mb.id and v.day = today)) as today_visit,
             case when cur then public._streak(mb.id) else 0 end as streak
           from public.members mb
           left join mp on mp.member_id = mb.id
           left join tp on tp.member_id = mb.id
           where mb.active
         )
    select json_build_object(
      'month_start', mo,
      'days_in_month', nx - mo,
      'elapsed', case when cur then today - mo + 1 else nx - mo end,
      'is_current', cur,
      'today', today,
      'first_month', (select to_char(min(day), 'YYYY-MM') from public.visits),
      'members', (select coalesce(json_agg(r order by r.points desc, r.days desc, r.name), '[]'::json) from r)
    )
  );
end $$;

-- 내 기록: 기존 항목 + 점수(오늘, 이번 주, 지난주 같은 때, 누적)
create or replace function public.club_my_stats(p_code text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare m public.members; today date := public._kst_today(); wk date;
begin
  m := public._member(p_code);
  if m.id is null then return null; end if;
  wk := date_trunc('week', today)::date;
  return json_build_object(
    'name', m.name,
    'streak', public._streak(m.id),
    'days_total', (select count(*) from public.visits where member_id = m.id),
    'days_30', (select count(*) from public.visits where member_id = m.id and day > today - 30),
    'visit_days', (select coalesce(json_agg(day order by day), '[]'::json) from public.visits where member_id = m.id and day > today - 35),
    'played', (select count(distinct briefing_id) from public.events where member_id = m.id and kind = 'play'),
    'completed', (select coalesce(json_agg(distinct briefing_id), '[]'::json) from public.events where member_id = m.id and kind = 'complete'),
    'lookups', (select count(*) from public.events where member_id = m.id and kind = 'lookup'),
    'goal', 20,
    'today_points', (select coalesce(sum(pts), 0) from public._day_points(today, today) where member_id = m.id),
    'week_points', (select coalesce(sum(pts), 0) from public._day_points(wk, today) where member_id = m.id),
    'prev_points', (select coalesce(sum(pts), 0) from public._day_points(wk - 7, today - 7) where member_id = m.id),
    'total_points', (select coalesce(sum(pts), 0) from public._day_points('2000-01-01', today) where member_id = m.id)
  );
end $$;

revoke execute on function public._day_points(date, date) from public, anon, authenticated;
revoke execute on function public.club_board(text) from public, authenticated;
grant execute on function public.club_board(text) to anon;
revoke execute on function public.club_board_month(text, text) from public, authenticated;
grant execute on function public.club_board_month(text, text) to anon;
revoke execute on function public.club_my_stats(text) from public, authenticated;
grant execute on function public.club_my_stats(text) to anon;

select '업데이트 완료: 점수 · 주간 목표 · 동아리 목표 · 레벨' as "결과";
