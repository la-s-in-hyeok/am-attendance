-- =====================================================================
--  AM청년회 출석부 — Supabase 서버 설정 스크립트
-- =====================================================================
--  사용법
--    Supabase 대시보드 → 왼쪽 SQL Editor → New query →
--    이 파일 내용을 "전부" 복사해 붙여넣기 → 오른쪽 아래 Run.
--    "Success. No rows returned" 가 나오면 끝이에요.
--
--  여러 번 실행해도 안전해요. 이미 들어 있는 명단·출석 기록·비밀번호는 그대로 남아요.
--  (앱을 새 버전으로 바꿀 때 이 파일을 다시 실행하면 서버 기능만 새것으로 바뀌어요.)
--
--  1부·2부 예배 구분(1부 = 노랑, 2부 = 민트)이 들어간 버전이에요.
--  예전 schema.sql 을 이미 실행했던 서버라면, 이 파일을 한 번 더 Run 하면 돼요.
--  출석 기록에 '몇 부' 칸이 붙고, 예전 출석 기록은 그대로 남아 1부로 보여요.
--
--  목장 '완료' / '수정' 버튼과 완료 알림도 이 스크립트에 들어 있어요. (group_days, push_subs 표)
--  예전 스크립트로 만든 서버는 한 번 더 Run 해야 '완료' 버튼을 쓸 수 있어요.
--  '완료'된 목장의 출석은 서버에서도 막아요. (다른 휴대폰이 그 목장을 열어 둔 채 눌러도 저장되지 않아요.
--  '수정'을 누른 동안에는 고칠 수 있어요)
--  앱을 꺼 둔 휴대폰 알림(am-notify)에는 공용 비밀번호를 보내지 않고, 완료할 때 서버가 만든
--  한 번 쓰는 알림 열쇠만 보내요. 이 스크립트를 다시 Run 했으면 am-notify 함수도 새것으로 다시 올려 주세요.
--
--  청년회 캘린더(일정 + 회의록)도 이 스크립트에 들어 있어요. (events, event_notes 표)
--  처음 Run 할 때 한 번만 2027년 청년회 일정 31개를 넣어 둬요. 나중에 일정을 다 지우고 다시 Run 해도
--  다시 생기지 않아요. (app_settings 의 'calendar_seeded' 표시를 보고 판단해요)
--  예전 스크립트로 만든 서버는 한 번 더 Run 해야 캘린더를 쓸 수 있어요.
--
--  목장보고서(매주 목장마다 PDF 하나)도 이 스크립트에 들어 있어요. (report_files, report_weeks, file_tickets 표)
--  Run 하면 Storage 에 비공개 보관함 'am-reports'(파일 하나 최대 45MB, PDF 만)와 그 규칙도 만들어요.
--  보관함은 비밀번호를 확인한 함수가 준 15분짜리 허락표가 있을 때만 파일을 올리고·받고·지울 수 있어요.
--  예전 스크립트로 만든 서버는 한 번 더 Run 해야 목장보고서를 쓸 수 있어요.
--
--  보안 구조
--    · 모든 표(테이블)는 RLS(행 수준 보안)를 켜 두고 허용 규칙을 하나도 만들지 않아요.
--      → 앱 주소와 anon key 를 알아도 표를 직접 읽거나 고칠 수 없어요.
--    · 앱은 아래의 am_ 로 시작하는 함수(RPC)만 부를 수 있고,
--      함수마다 첫 번째 값으로 공용 비밀번호(p_code)를 받아 확인해요.
--    · 비밀번호는 bcrypt 로 암호화해서 app_settings 에 저장해요. 처음 비밀번호는 0000.
--    · 틀린 비밀번호는 기기(인터넷 주소)마다 따로 세요.
--      한 기기가 10분 안에 서로 다른 틀린 비밀번호를 10번 넣으면 그 기기만 잠시(최대 10분) 막아요.
--      다른 휴대폰은 그대로 써요.
--    · 비상 잠금: 여러 곳에서 한꺼번에 10분 안에 서로 다른 틀린 비밀번호가 100개 이상 들어오면,
--      최근 30일 안에 맞는 비밀번호로 들어온 적 없는 기기(인터넷 주소)는 잠시 막아요.
--    · 비밀번호 확인은 쓰기가 되는 요청(POST)에서만 해요.
--      (읽기 전용 요청에서는 틀린 기록을 남길 수 없어서, 맞든 틀리든 거절해요)
-- =====================================================================

set search_path = public, extensions;

-- 암호화 기능 (Supabase 에는 보통 이미 켜져 있어요)
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Supabase 가 아닌 일반 PostgreSQL 에서 시험할 때를 위한 역할 (Supabase 에서는 이미 있어서 아무 일도 안 해요)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

-- ---------------------------------------------------------------------
--  표(테이블)
-- ---------------------------------------------------------------------

-- 목장
create table if not exists public.groups (
  id          uuid primary key,
  name        text not null,
  sort_order  integer not null default 0,
  archived    boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- 목장원 (removed_on 이 있으면 그 주일부터 명단에서 빠진 사람)
create table if not exists public.members (
  id          uuid primary key,
  name        text not null,
  group_id    uuid not null references public.groups (id),
  role        text check (role is null or role in ('leader', 'manager')),
  sort_order  integer not null default 0,
  joined_on   date not null,
  removed_on  date,
  note        text not null default '',
  updated_at  timestamptz not null default now()
);
create index if not exists members_group_idx on public.members (group_id);

-- 출석 기록 (기록이 없으면 '미확인')
--  service: 출석일 때 몇 부 예배인지. 1 = 1부(노랑), 2 = 2부(민트). 출석이 아니면 비워 둬요(null).
--           예전 버전에서 저장한 출석 기록은 비어 있고, 1부로 봐요.
create table if not exists public.attendance (
  date        date not null,
  member_id   uuid not null references public.members (id) on delete cascade,
  group_id    uuid not null,
  status      text not null check (status in ('present', 'away', 'nocontact', 'other')),
  service     smallint,
  reason      text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (date, member_id)
);

-- 예전 스크립트로 만든 서버에는 service 칸이 없어서 새로 붙여요 (이미 있으면 아무 일도 안 해요)
alter table public.attendance add column if not exists service smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_service_check'
  ) then
    alter table public.attendance
      add constraint attendance_service_check check (service is null or service in (1, 2));
  end if;
end
$$;

create index if not exists attendance_date_idx    on public.attendance (date);
create index if not exists attendance_member_idx  on public.attendance (member_id);
create index if not exists attendance_updated_idx on public.attendance (updated_at);

-- 지운 출석 기록 표시 (다른 기기가 '바뀐 것만' 받아 갈 때 지워진 것도 알 수 있도록. 45일 뒤 자동 정리)
create table if not exists public.attendance_deleted (
  date        date not null,
  member_id   uuid not null,
  deleted_at  timestamptz not null default now(),
  primary key (date, member_id)
);
create index if not exists attendance_deleted_at_idx on public.attendance_deleted (deleted_at);

-- 주일별 기타 기록 (새친구·새신자 / 방문 / 바나바 현황 / 메모)
create table if not exists public.week_notes (
  date        date primary key,
  newcomers   jsonb not null default '[]'::jsonb,
  visitors    jsonb not null default '[]'::jsonb,
  barnabas    text not null default '',
  memo        text not null default '',
  updated_at  timestamptz not null default now()
);

-- 설정 (비밀번호 암호값 등)
create table if not exists public.app_settings (
  key    text primary key,
  value  text not null
);

-- 틀린 비밀번호 기록 (하루 뒤 자동 정리)
--  비밀번호 자체도, 인터넷 주소(IP) 자체도 저장하지 않고 알아볼 수 없는 값만 남겨요.
--  client_key: 어느 기기(인터넷 주소)에서 왔는지. 'unknown' = 알 수 없음
create table if not exists public.login_attempts (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  code_hash   text not null default '',
  client_key  text not null default 'unknown'
);
alter table public.login_attempts add column if not exists code_hash text not null default '';
alter table public.login_attempts add column if not exists client_key text not null default 'unknown';
create index if not exists login_attempts_at_idx on public.login_attempts (at);
create index if not exists login_attempts_client_idx on public.login_attempts (client_key, at);

-- 맞는 비밀번호로 들어온 적 있는 기기(인터넷 주소) (비상 잠금 때도 이 기기들은 계속 쓸 수 있도록. 30일 뒤 자동 정리)
create table if not exists public.login_trusted (
  client_key  text primary key,
  at          timestamptz not null default now()
);

-- 목장별 출석체크 완료 (주일·목장마다 한 줄. 줄이 없으면 아직 완료 전)
--  state:      done = 완료 (앱에서 그 목장 명단이 잠겨요), editing = 완료한 뒤 '수정' 중
--  done_at:    마지막으로 완료(또는 수정 완료)를 누른 시각
--  edit_count: 완료한 뒤 '수정 완료'를 누른 횟수
--  pushed_at:  이 완료를 Web Push 로 알린 시각 (같은 알림을 두 번 보내지 않도록)
--  push_token / push_token_at: 완료를 누른 기기에만 주는 한 번 쓰는 알림 열쇠와 만든 시각.
--              알림 함수(am-notify)는 공용 비밀번호 대신 이 열쇠를 받아요. 10분 지나거나 한 번 쓰면 없어져요
create table if not exists public.group_days (
  date           date not null,
  group_id       uuid not null references public.groups (id) on delete cascade,
  state          text not null check (state in ('done', 'editing')),
  done_at        timestamptz,
  edit_count     integer not null default 0,
  pushed_at      timestamptz,
  push_token     text,
  push_token_at  timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (date, group_id)
);
-- 예전 스크립트로 만든 서버에는 알림 열쇠 칸이 없어서 새로 붙여요 (이미 있으면 아무 일도 안 해요)
alter table public.group_days add column if not exists push_token text;
alter table public.group_days add column if not exists push_token_at timestamptz;

-- 앱을 꺼 두어도 알림 받기(Web Push)를 켠 기기 (선택 기능. 쓰지 않으면 비어 있어요)
--  endpoint: 휴대폰 회사(애플·구글 등) 알림 서버의 주소, keys: 알림을 암호화하는 열쇠. 이름 같은 개인 정보는 없어요
create table if not exists public.push_subs (
  endpoint    text primary key,
  keys        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subs_updated_idx on public.push_subs (updated_at);

-- 청년회 캘린더 일정 (하루 종일 일정만. 여러 날이면 start_date ~ end_date, 양 끝 포함)
--  color:      일정 색 이름 (pink, peach, butter, mint, sky, lavender, lilac, aqua 중 하나)
--  deleted_at: 지운 일정 (30일 안에는 되돌릴 수 있어요. 30일이 지나면 회의록과 함께 정리해요)
create table if not exists public.events (
  id          uuid primary key,
  title       text not null,
  start_date  date not null,
  end_date    date not null,
  color       text not null,
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists events_start_idx on public.events (start_date) where deleted_at is null;
create index if not exists events_deleted_idx on public.events (deleted_at) where deleted_at is not null;

-- 일정마다 회의록 하나 (에디터 문서 JSON, 최대 약 300KB)
--  plain_len: 글자 수 (목록에 📝 표시용. 앱이 세어서 보내요)
--  version:   판 번호. 저장할 때마다 1씩 올라가요 (두 기기가 같은 회의록을 고칠 때 덮어쓰지 않도록)
create table if not exists public.event_notes (
  event_id    uuid primary key references public.events (id) on delete cascade,
  doc         jsonb not null,
  plain_len   integer not null default 0,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);

-- 처음 비밀번호 0000 (이미 있으면 그대로 둬요)
insert into public.app_settings (key, value)
values ('passcode_hash', crypt('0000', gen_salt('bf')))
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('attempt_salt', encode(gen_random_bytes(16), 'hex'))
on conflict (key) do nothing;

-- 2027년 청년회 일정 (처음 한 번만. 2026년 행사표를 요일에 맞춰 2027년 달력으로 옮겼어요)
--  'calendar_seeded' 표시가 이미 있으면 아무것도 안 해요 (일정을 다 지운 뒤 다시 Run 해도 다시 생기지 않아요).
--  각 행사의 설명은 그 일정 회의록의 첫 문단으로 넣어요. 글자 수(plain_len)는 0 으로 둬서
--  📝 표시는 누가 실제로 회의록을 쓴 뒤에만 보여요.
--  체험 모드(src/lib/calendarSeed.ts)와 같은 내용·같은 id 예요. 한쪽을 고치면 다른 쪽도 고쳐 주세요.
do $$
declare
  r record;
begin
  -- 표시를 먼저 넣어 봐요. 이미 있으면(예전에 넣었음) 끝 (두 곳에서 동시에 Run 해도 한 번만 들어가요)
  insert into public.app_settings (key, value)
  values ('calendar_seeded', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  on conflict (key) do nothing;
  if not found then
    return;
  end if;

  for r in
    select s.id::uuid as id, s.d1::date as d1, s.d2::date as d2, s.title, s.color, s.memo
    from (values
      ('27000000-0000-4000-8000-000000000001', '2027-01-02', '2027-01-02', '목장은퇴·목자파송·신입생환영회', 'sky', '토요예배 2부 순서: 목장 은퇴 & 신규 목자 파송 & 신입생 환영회'),
      ('27000000-0000-4000-8000-000000000002', '2027-01-14', '2027-01-14', '신입생 OT', 'peach', '신입생 OT'),
      ('27000000-0000-4000-8000-000000000003', '2027-01-16', '2027-01-16', '바나바사역자 교육', 'mint', '토요예배 때'),
      ('27000000-0000-4000-8000-000000000004', '2027-01-23', '2027-01-23', '전도교육세미나', 'butter', '토요예배 때'),
      ('27000000-0000-4000-8000-000000000005', '2027-01-24', '2027-01-24', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000006', '2027-01-30', '2027-01-30', '설날 예배', 'pink', '학생회와 연합예배, 보드게임과 치킨 (2026년에는 설 연휴 전 토요일에 했어요)'),
      ('27000000-0000-4000-8000-000000000007', '2027-02-25', '2027-02-27', '청년 수련회', 'aqua', '2027 청년수련회 (2월 25~27일)'),
      ('27000000-0000-4000-8000-000000000008', '2027-02-28', '2027-02-28', '청년주일', 'sky', '청년주일'),
      ('27000000-0000-4000-8000-000000000009', '2027-02-28', '2027-02-28', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000010', '2027-03-20', '2027-03-20', '볼링대회', 'peach', '토요예배 대체'),
      ('27000000-0000-4000-8000-000000000011', '2027-03-28', '2027-03-28', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000012', '2027-04-20', '2027-04-20', '캠퍼스 전도', 'mint', '군산대·간호대'),
      ('27000000-0000-4000-8000-000000000013', '2027-04-22', '2027-04-22', '캠퍼스 전도', 'mint', '군산대·간호대'),
      ('27000000-0000-4000-8000-000000000014', '2027-04-25', '2027-04-25', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000015', '2027-05-01', '2027-05-01', '목자총무 위로회', 'lilac', '순천'),
      ('27000000-0000-4000-8000-000000000016', '2027-05-08', '2027-05-08', '봄봄봄 야외예배', 'butter', '금강하굿둑 (칼국수, 레크리에이션 등)'),
      ('27000000-0000-4000-8000-000000000017', '2027-05-15', '2027-05-15', '스승의 날 행사', 'pink', '토요예배 2부 순서 — 목사님께 과일 컵바구니, 전기그릴'),
      ('27000000-0000-4000-8000-000000000018', '2027-05-23', '2027-05-23', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000019', '2027-05-29', '2027-05-29', 'M.E.E.T 행사', 'aqua', '원스타임오프'),
      ('27000000-0000-4000-8000-000000000020', '2027-06-27', '2027-06-27', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000021', '2027-07-25', '2027-07-25', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000022', '2027-07-26', '2027-07-29', '가족수련회', 'peach', '2026년은 제41회 가족수련회'),
      ('27000000-0000-4000-8000-000000000023', '2027-08-07', '2027-08-07', '그레이스 토크쇼', 'lilac', '토요예배 — 2청과 연합, 주교관 카페'),
      ('27000000-0000-4000-8000-000000000024', '2027-08-22', '2027-08-22', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000025', '2027-09-26', '2027-09-26', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000026', '2027-10-16', '2027-10-16', '사랑의 연탄봉사 & 목자총무 파송식', 'mint', '사랑의 연탄봉사 & 목자총무 파송식'),
      ('27000000-0000-4000-8000-000000000027', '2027-10-23', '2027-10-23', 'P.M 축제', 'butter', 'P.M 축제'),
      ('27000000-0000-4000-8000-000000000028', '2027-10-24', '2027-10-24', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000029', '2027-11-21', '2027-11-21', '추수감사절', 'peach', '추수감사절 절기 행사 (셋째 주일)'),
      ('27000000-0000-4000-8000-000000000030', '2027-11-28', '2027-11-28', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대'),
      ('27000000-0000-4000-8000-000000000031', '2027-12-26', '2027-12-26', '청년회 오후 성가대', 'lavender', '매달 4주째는 청년회 오후 성가대')
    ) as s (id, d1, d2, title, color, memo)
  loop
    insert into public.events (id, title, start_date, end_date, color)
    values (r.id, r.title, r.d1, r.d2, r.color)
    on conflict (id) do nothing;

    insert into public.event_notes (event_id, doc, plain_len, version)
    values (
      r.id,
      jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', r.memo))
        ))
      ),
      0,
      1
    )
    on conflict (event_id) do nothing;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
--  직접 접근 막기: RLS 켜고 허용 규칙은 만들지 않아요
-- ---------------------------------------------------------------------
alter table public.groups              enable row level security;
alter table public.members             enable row level security;
alter table public.attendance          enable row level security;
alter table public.attendance_deleted  enable row level security;
alter table public.week_notes          enable row level security;
alter table public.app_settings        enable row level security;
alter table public.login_attempts      enable row level security;
alter table public.login_trusted       enable row level security;
alter table public.group_days          enable row level security;
alter table public.push_subs           enable row level security;
alter table public.events              enable row level security;
alter table public.event_notes         enable row level security;

revoke all on table
  public.groups, public.members, public.attendance, public.attendance_deleted,
  public.week_notes, public.app_settings, public.login_attempts, public.login_trusted,
  public.group_days, public.push_subs, public.events, public.event_notes
from public, anon, authenticated;
revoke all on sequence public.login_attempts_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  내부 도우미 함수 (앱에서 직접 부를 수 없어요)
-- ---------------------------------------------------------------------

-- 예전 버전의 '모두 함께 잠기는' 확인 함수는 이제 쓰지 않아요
drop function if exists public.am__locked();

-- 지금 요청의 머리글(headers). Supabase 가 아닌 곳에서 부르면 null
create or replace function public.am__headers()
returns json
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v json;
begin
  v := nullif(current_setting('request.headers', true), '')::json;
  if v is not null and json_typeof(v) = 'object' then
    return v;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- 요청을 보낸 기기(인터넷 주소)를 알아볼 수 없는 값으로 바꿔요. 주소를 모르면 'unknown'
--  cf-connecting-ip 를 먼저 봐요: Supabase 앞단(Cloudflare)이 직접 넣는 값이라 앱에서 속일 수 없어요.
--  x-forwarded-for 의 맨 앞 값은 보내는 쪽이 마음대로 적을 수 있어서 그다음에 봐요.
--  IPv6 는 한 집·한 휴대폰이 주소를 여러 개 쓰므로 앞 64비트(/64)로 묶어요.
create or replace function public.am__client_key()
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_h    json := public.am__headers();
  v_ip   text;
  v_net  inet;
  v_salt text;
begin
  if v_h is not null then
    v_ip := coalesce(
      nullif(btrim(v_h ->> 'cf-connecting-ip'), ''),
      nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),
      nullif(btrim(v_h ->> 'x-real-ip'), '')
    );
  end if;
  if v_ip is null then
    return 'unknown';
  end if;

  begin
    v_net := v_ip::inet;
    if family(v_net) = 6 then
      v_ip := host(network(set_masklen(v_net, 64)));
    else
      v_ip := host(v_net);
    end if;
  exception when others then
    v_ip := left(v_ip, 100);
  end;

  select s.value into v_salt from public.app_settings s where s.key = 'attempt_salt';
  return 'h:' || left(encode(digest(coalesce(v_salt, '') || ':ip:' || v_ip, 'sha256'), 'hex'), 32);
end;
$$;

-- 비밀번호 확인: 'ok' | 'bad_code' | 'locked'
-- 틀리면 기록을 남겨요. 예외(raise)를 쓰면 기록까지 취소되므로 값으로 돌려줘요.
create or replace function public.am__verify(p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_salt  text;
  v_try   text;
  v_key   text;
  v_limit integer;
  v_h     json;
begin
  -- 0) 맨 먼저: 틀린 기록을 남길 수 있는 요청(POST, 읽기·쓰기 트랜잭션)에서만 확인해요.
  --    GET·HEAD 로 부르면 Supabase(PostgREST)가 읽기 전용으로 실행해서 틀린 기록이 안 남아요.
  --    그러면 끝없이 맞혀 볼 수 있으므로, 비밀번호가 맞든 틀리든 같은 오류로 거절해요.
  if current_setting('transaction_read_only') = 'on'
     or coalesce(nullif(current_setting('request.method', true), ''), 'POST') <> 'POST' then
    raise exception 'AM_POST_ONLY' using errcode = 'P0001';
  end if;
  -- 요청이 끝날 때 되돌리게(tx=rollback) 해서 기록을 지우는 것도 막아요
  v_h := public.am__headers();
  if v_h is not null and coalesce(v_h ->> 'prefer', '') ~* 'tx\s*=\s*rollback' then
    raise exception 'AM_POST_ONLY' using errcode = 'P0001';
  end if;
  -- 한 요청(트랜잭션)에서 비밀번호 확인은 한 번만 해요.
  -- (GraphQL 등으로 여러 번 묶어 보내고 통째로 되돌려서 틀린 기록을 지우는 우회를 막아요)
  if current_setting('am.verified', true) = '1' then
    raise exception 'AM_ONE_CALL' using errcode = 'P0001';
  end if;
  perform set_config('am.verified', '1', true);

  v_key := public.am__client_key();
  -- 같은 기기에서 동시에 여러 번 보내도 하나씩 세도록
  perform pg_advisory_xact_lock(hashtext('am_verify'), hashtext(v_key));

  -- 1) 이 기기가 10분 안에 서로 다른 틀린 비밀번호를 10번 넣었으면 잠깐 막아요 (맞는 비밀번호도)
  --    주소를 알 수 없는 요청('unknown')은 모두 한 묶음이라 예전처럼 15번까지 봐줘요.
  v_limit := case when v_key = 'unknown' then 15 else 10 end;
  if (select count(distinct a.code_hash)
      from public.login_attempts a
      where a.client_key = v_key and a.at > now() - interval '10 minutes') >= v_limit then
    return 'locked';
  end if;

  -- 2) 비상 잠금: 여러 곳에서 한꺼번에 맞혀 보는 중이면(10분 안에 서로 다른 틀린 값 100개 이상)
  --    최근 30일 안에 맞는 비밀번호로 들어온 적 없는 기기는 잠시 막아요. 쓰던 휴대폰은 그대로 써요.
  if not exists (
    select 1 from public.login_trusted t
    where t.client_key = v_key and t.at > now() - interval '30 days'
  ) then
    if (select count(distinct a.code_hash)
        from public.login_attempts a
        where a.at > now() - interval '10 minutes') >= 100 then
      return 'locked';
    end if;
  end if;

  select s.value into v_hash from public.app_settings s where s.key = 'passcode_hash';

  if v_hash is not null
     and p_code is not null
     and length(p_code) between 1 and 32
     and crypt(p_code, v_hash) = v_hash then
    -- 이 기기는 맞는 비밀번호를 아는 기기 (10분에 한 번만 시간을 고쳐 써요)
    insert into public.login_trusted as t (client_key, at)
    values (v_key, now())
    on conflict (client_key) do update set at = excluded.at
      where t.at < now() - interval '10 minutes';
    return 'ok';
  end if;

  -- 같은 기기에서 같은 틀린 값은 10분 안에 한 번만 세요
  -- (비밀번호를 바꾼 뒤 예전 비밀번호로 열려 있던 휴대폰들 때문에 잠기지 않도록)
  select s.value into v_salt from public.app_settings s where s.key = 'attempt_salt';
  v_try := encode(digest(coalesce(v_salt, '') || ':' || left(coalesce(p_code, ''), 64), 'sha256'), 'hex');

  insert into public.login_attempts (code_hash, client_key)
  select v_try, v_key
  where not exists (
    select 1 from public.login_attempts a
    where a.client_key = v_key and a.code_hash = v_try and a.at > now() - interval '10 minutes'
  );

  delete from public.login_attempts la where la.at < now() - interval '1 day';
  delete from public.login_trusted lt where lt.at < now() - interval '30 days';

  return 'bad_code';
end;
$$;

-- 목장 여러 개 넣기 (id 가 같으면 덮어쓰기, 없으면 추가). am_save_groups · am_import_roster 가 함께 써요
create or replace function public.am__put_groups(p_groups jsonb)
returns void
language sql
volatile
set search_path = public, extensions
as $$
  insert into public.groups (id, name, sort_order, archived, updated_at)
  select d.id, d.name, d.sort_order, d.archived, now()
  from (
    -- 같은 id 가 여러 번 오면 마지막 것만
    select distinct on (x.id) x.id, x.name, x.sort_order, x.archived
    from (
      select
        (t.e ->> 'id')::uuid                                   as id,
        coalesce(t.e ->> 'name', '')                           as name,
        coalesce(round((t.e ->> 'order')::numeric)::integer, 0) as sort_order,
        coalesce((t.e ->> 'archived')::boolean, false)         as archived,
        t.i
      from jsonb_array_elements(p_groups) with ordinality as t(e, i)
    ) x
    order by x.id, x.i desc
  ) d
  on conflict (id) do update
    set name       = excluded.name,
        sort_order = excluded.sort_order,
        archived   = excluded.archived,
        updated_at = excluded.updated_at;
$$;

-- 목장원 여러 명 넣기 (id 가 같으면 덮어쓰기, 없으면 추가). am_save_members · am_import_roster 가 함께 써요
create or replace function public.am__put_members(p_members jsonb)
returns void
language sql
volatile
set search_path = public, extensions
as $$
  insert into public.members (id, name, group_id, role, sort_order, joined_on, removed_on, note, updated_at)
  select d.id, d.name, d.group_id, d.role, d.sort_order, d.joined_on, d.removed_on, d.note, now()
  from (
    select distinct on (x.id) x.*
    from (
      select
        (t.e ->> 'id')::uuid                                          as id,
        coalesce(t.e ->> 'name', '')                                  as name,
        (t.e ->> 'groupId')::uuid                                     as group_id,
        nullif(t.e ->> 'role', '')                                    as role,
        coalesce(round((t.e ->> 'order')::numeric)::integer, 0)       as sort_order,
        coalesce(nullif(t.e ->> 'joinedOn', '')::date, '2000-01-01'::date) as joined_on,
        nullif(t.e ->> 'removedOn', '')::date                         as removed_on,
        coalesce(t.e ->> 'note', '')                                  as note,
        t.i
      from jsonb_array_elements(p_members) with ordinality as t(e, i)
    ) x
    order by x.id, x.i desc
  ) d
  on conflict (id) do update
    set name       = excluded.name,
        group_id   = excluded.group_id,
        role       = excluded.role,
        sort_order = excluded.sort_order,
        joined_on  = excluded.joined_on,
        removed_on = excluded.removed_on,
        note       = excluded.note,
        updated_at = excluded.updated_at;
$$;

-- 새친구·방문 목록 정리: [{name, note}] 모양만 남겨요
create or replace function public.am__named(p jsonb)
returns jsonb
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when jsonb_typeof(p) = 'array' then coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'name', coalesce(t.e ->> 'name', ''),
                 'note', coalesce(t.e ->> 'note', '')
               )
               order by t.i
             )
      from jsonb_array_elements(p) with ordinality as t(e, i)
      where jsonb_typeof(t.e) = 'object'
    ), '[]'::jsonb)
    else '[]'::jsonb
  end;
$$;

-- 목장 완료 상태 한 줄 → 앱이 쓰는 모양
create or replace function public.am__group_day_json(d public.group_days)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'date',      to_char(d.date, 'YYYY-MM-DD'),
    'groupId',   d.group_id,
    'state',     d.state,
    'doneAt',    to_char(d.done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'editCount', d.edit_count,
    'updatedAt', to_char(d.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

-- 그 주일에 '완료'된 목장이 하나라도 들어 있는지 (출석 저장·지우기가 써요. 'editing'(수정 중)은 막지 않아요)
--  완료 처리(am_set_group_day)와 같은 열쇠로 '함께 쓰기(shared)' 잠금을 걸어요.
--  누군가 완료를 누르는 중이면 그게 끝날 때까지 기다렸다가 확인하고, 출석 저장끼리는 서로 기다리지 않아요.
--  잠금은 목장 id 순서대로 걸어서 서로 기다리다 멈추는 일(deadlock)이 없도록 해요.
create or replace function public.am__group_done(p_date date, p_group_ids uuid[])
returns boolean
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_gid uuid;
begin
  if p_date is null then
    return false;
  end if;
  for v_gid in
    select distinct u.g from unnest(p_group_ids) as u(g) where u.g is not null order by u.g
  loop
    perform pg_advisory_xact_lock_shared(hashtext('am_group_day'), hashtext(p_date::text || ':' || v_gid::text));
  end loop;
  return exists (
    select 1 from public.group_days d
    where d.date = p_date and d.state = 'done' and d.group_id = any (p_group_ids)
  );
end;
$$;

revoke all on function public.am__group_done(date, uuid[])       from public, anon, authenticated;
revoke all on function public.am__group_day_json(public.group_days) from public, anon, authenticated;
revoke all on function public.am__headers()                   from public, anon, authenticated;
revoke all on function public.am__client_key()                from public, anon, authenticated;
revoke all on function public.am__verify(text)                from public, anon, authenticated;
revoke all on function public.am__named(jsonb)                from public, anon, authenticated;
revoke all on function public.am__put_groups(jsonb)           from public, anon, authenticated;
revoke all on function public.am__put_members(jsonb)          from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  앱이 부르는 함수 (RPC)
--  · 비밀번호가 틀리거나 잠겨 있으면 {"error": "bad_code" | "locked"} 를 돌려줘요.
--  · 쓰기 함수는 성공하면 {"ok": true} 를 돌려줘요.
--  · 목록은 jsonb 한 덩어리로 돌려줘요 (1000줄 제한에 걸리지 않도록).
-- ---------------------------------------------------------------------

-- 로그인: 맞으면 true, 틀리면 false, 잠겨 있으면 오류 AM_LOCKED
create or replace function public.am_login(p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v = 'locked' then
    raise exception 'AM_LOCKED' using errcode = 'P0001',
      hint = '비밀번호를 여러 번 틀려서 잠시 잠겼어요. 10분 뒤에 다시 시도해 주세요.';
  end if;
  return v = 'ok';
end;
$$;

-- 비밀번호 바꾸기 (숫자 4~8자리)
create or replace function public.am_change_passcode(p_code text, p_next text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_next is null or p_next !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('error', 'invalid_passcode');
  end if;

  insert into public.app_settings (key, value)
  values ('passcode_hash', crypt(p_next, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('ok', true);
end;
$$;

-- 목장·목장원 전체
create or replace function public.am_get_roster(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  return jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',       g.id,
                 'name',     g.name,
                 'order',    g.sort_order,
                 'archived', g.archived
               )
               order by g.sort_order, g.name
             )
      from public.groups g
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id',        m.id,
                 'name',      m.name,
                 'groupId',   m.group_id,
                 'role',      m.role,
                 'order',     m.sort_order,
                 'joinedOn',  to_char(m.joined_on, 'YYYY-MM-DD'),
                 'removedOn', to_char(m.removed_on, 'YYYY-MM-DD'),
                 'note',      m.note
               )
               order by m.group_id, m.sort_order, m.name
             )
      from public.members m
    ), '[]'::jsonb)
  );
end;
$$;

-- 기간(양 끝 포함)의 출석 기록
create or replace function public.am_get_attendance(p_code text, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'date',      to_char(a.date, 'YYYY-MM-DD'),
               'memberId',  a.member_id,
               'groupId',   a.group_id,
               'status',    a.status,
               'service',   case when a.status = 'present' then coalesce(a.service, 1) end,
               'reason',    a.reason,
               'updatedAt', to_char(a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             )
             order by a.date, a.member_id
           )
    from public.attendance a
    where a.date >= coalesce(p_from, '0001-01-01'::date)
      and a.date <= coalesce(p_to,   '9999-12-31'::date)
  ), '[]'::jsonb);
end;
$$;

-- 바뀐 출석 기록만 (앱이 자주 새로고침해도 데이터를 조금만 쓰도록)
--  p_since 가 비어 있거나 30일보다 오래됐으면 p_from 이후 전부를 돌려주고 full = true.
--  돌려준 now 를 다음 호출의 p_since 로 쓰면 돼요. (늦게 저장된 것을 놓치지 않도록 2분 겹쳐서 찾아요)
create or replace function public.am_get_attendance_changes(p_code text, p_since timestamptz, p_from date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v       text;
  v_from  date := coalesce(p_from, '0001-01-01'::date);
  v_since timestamptz;
  v_now   text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  if p_since is null or p_since < now() - interval '30 days' then
    return jsonb_build_object(
      'full', true,
      'now', v_now,
      'records', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'date',      to_char(a.date, 'YYYY-MM-DD'),
                   'memberId',  a.member_id,
                   'groupId',   a.group_id,
                   'status',    a.status,
                   'service',   case when a.status = 'present' then coalesce(a.service, 1) end,
                   'reason',    a.reason,
                   'updatedAt', to_char(a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 )
                 order by a.date, a.member_id
               )
        from public.attendance a
        where a.date >= v_from
      ), '[]'::jsonb),
      'deleted', '[]'::jsonb
    );
  end if;

  v_since := p_since - interval '2 minutes';

  return jsonb_build_object(
    'full', false,
    'now', v_now,
    'records', coalesce((
      select jsonb_agg(
             jsonb_build_object(
               'date',      to_char(a.date, 'YYYY-MM-DD'),
               'memberId',  a.member_id,
               'groupId',   a.group_id,
               'status',    a.status,
               'service',   case when a.status = 'present' then coalesce(a.service, 1) end,
               'reason',    a.reason,
               'updatedAt', to_char(a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             )
             order by a.date, a.member_id
           )
      from public.attendance a
      where a.updated_at > v_since and a.date >= v_from
    ), '[]'::jsonb),
    'deleted', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(d.date, 'YYYY-MM-DD'), 'memberId', d.member_id))
      from public.attendance_deleted d
      where d.deleted_at > v_since and d.date >= v_from
    ), '[]'::jsonb)
  );
end;
$$;

-- 기간(양 끝 포함)의 주일 기타 기록
create or replace function public.am_get_week_notes(p_code text, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'date',      to_char(n.date, 'YYYY-MM-DD'),
               'newcomers', n.newcomers,
               'visitors',  n.visitors,
               'barnabas',  n.barnabas,
               'memo',      n.memo,
               'updatedAt', to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             )
             order by n.date
           )
    from public.week_notes n
    where n.date >= coalesce(p_from, '0001-01-01'::date)
      and n.date <= coalesce(p_to,   '9999-12-31'::date)
  ), '[]'::jsonb);
end;
$$;

-- 출석 기록 저장 (같은 주일·같은 사람이면 덮어쓰기)
--  service: 출석이 아니면 비워요(null). 출석인데 값이 없거나 이상하면 1부로 저장해요.
--  돌려주는 값에 service 를 넣어서, 앱이 "새 스크립트로 바뀐 서버"인지 알 수 있어요.
--  그 주일에 '완료'된 목장이면 아무것도 바꾸지 않고 {"error": "group_done"} 를 돌려줘요.
--  (보낸 기록의 목장과, 이미 저장돼 있던 기록의 목장을 둘 다 봐요. 완료된 목장으로 옮기거나 거기서 빼는 것도 막아요)
create or replace function public.am_save_attendance(p_code text, p_record jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v         text;
  v_status  text := p_record ->> 'status';
  v_service smallint;
  v_date    date;
  v_member  uuid;
  v_group   uuid;
  v_old     uuid;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  v_date   := (p_record ->> 'date')::date;
  v_member := (p_record ->> 'memberId')::uuid;
  v_group  := (p_record ->> 'groupId')::uuid;

  -- 이미 있는 기록은 먼저 잡아 둬요 (확인하는 사이 다른 기기가 같은 칸의 목장을 바꾸지 못하도록)
  select a.group_id into v_old
  from public.attendance a
  where a.date = v_date and a.member_id = v_member
  for update;

  if public.am__group_done(v_date, array[v_group, v_old]) then
    return jsonb_build_object('error', 'group_done');
  end if;

  if v_status = 'present' then
    v_service := case when coalesce(p_record ->> 'service', '') in ('2', '2.0') then 2 else 1 end;
  else
    v_service := null;
  end if;

  insert into public.attendance (date, member_id, group_id, status, service, reason, updated_at)
  values (
    v_date,
    v_member,
    v_group,
    v_status,
    v_service,
    coalesce(p_record ->> 'reason', ''),
    now()
  )
  on conflict (date, member_id) do update
    set group_id   = excluded.group_id,
        status     = excluded.status,
        service    = excluded.service,
        reason     = excluded.reason,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'service', v_service);
end;
$$;

-- 출석 기록 지우기 (= 미확인으로 되돌리기)
--  지우려는 기록의 목장이 그 주일에 '완료'돼 있으면 지우지 않고 {"error": "group_done"} 를 돌려줘요.
create or replace function public.am_clear_attendance(p_code text, p_date date, p_member_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v     text;
  v_old uuid;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  select a.group_id into v_old
  from public.attendance a
  where a.date = p_date and a.member_id = p_member_id
  for update;

  if found and public.am__group_done(p_date, array[v_old]) then
    return jsonb_build_object('error', 'group_done');
  end if;

  delete from public.attendance a where a.date = p_date and a.member_id = p_member_id;

  insert into public.attendance_deleted (date, member_id, deleted_at)
  values (p_date, p_member_id, now())
  on conflict (date, member_id) do update set deleted_at = excluded.deleted_at;

  delete from public.attendance_deleted d where d.deleted_at < now() - interval '45 days';

  return jsonb_build_object('ok', true);
end;
$$;

-- 주일 기타 기록 저장 (같은 주일이면 덮어쓰기)
create or replace function public.am_save_week_note(p_code text, p_note jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  insert into public.week_notes (date, newcomers, visitors, barnabas, memo, updated_at)
  values (
    (p_note ->> 'date')::date,
    public.am__named(p_note -> 'newcomers'),
    public.am__named(p_note -> 'visitors'),
    coalesce(p_note ->> 'barnabas', ''),
    coalesce(p_note ->> 'memo', ''),
    now()
  )
  on conflict (date) do update
    set newcomers  = excluded.newcomers,
        visitors   = excluded.visitors,
        barnabas   = excluded.barnabas,
        memo       = excluded.memo,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true);
end;
$$;

-- 목장 여러 개 저장 (id 가 같으면 덮어쓰기, 없으면 추가)
create or replace function public.am_save_groups(p_code text, p_groups jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if jsonb_typeof(p_groups) is distinct from 'array' then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform public.am__put_groups(p_groups);

  return jsonb_build_object('ok', true);
end;
$$;

-- 목장원 여러 명 저장 (id 가 같으면 덮어쓰기, 없으면 추가)
create or replace function public.am_save_members(p_code text, p_members jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if jsonb_typeof(p_members) is distinct from 'array' then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform public.am__put_members(p_members);

  return jsonb_build_object('ok', true);
end;
$$;

-- 처음 명단 넣기 (엑셀 불러오기): 목장과 목장원을 한 번에 넣어요.
--  서버에 목장이 하나라도 있으면 아무것도 넣지 않고 {"error": "exists"} 를 돌려줘요.
--  두 사람이 동시에 눌러도 한 번만 들어가요. 중간에 하나라도 잘못되면 전부 취소돼요.
create or replace function public.am_import_roster(p_code text, p_groups jsonb, p_members jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if jsonb_typeof(p_groups) is distinct from 'array'
     or jsonb_typeof(p_members) is distinct from 'array'
     or jsonb_array_length(p_groups) = 0 then
    return jsonb_build_object('error', 'invalid');
  end if;

  -- 동시에 온 두 번째 요청은 첫 번째가 끝날 때까지 기다렸다가, 이미 들어간 명단을 보고 'exists' 가 돼요
  perform pg_advisory_xact_lock(hashtext('am_import_roster'));
  -- 쓰는 목장이나 명단에 있는 사람이 있으면 넣지 않아요 (삭제한 목장만 남아 있으면 넣어요)
  if exists (select 1 from public.groups where not archived)
     or exists (select 1 from public.members where removed_on is null) then
    return jsonb_build_object('error', 'exists');
  end if;

  perform public.am__put_groups(p_groups);
  perform public.am__put_members(p_members);

  return jsonb_build_object('ok', true);
end;
$$;

-- 목장원 완전 삭제 (출석 기록까지). 잘못 입력한 사람을 지울 때만 써요.
create or replace function public.am_purge_member(p_code text, p_member_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  -- 다른 기기도 지워진 기록을 알 수 있게 표시를 남기고
  insert into public.attendance_deleted (date, member_id, deleted_at)
  select a.date, a.member_id, now()
  from public.attendance a
  where a.member_id = p_member_id
  on conflict (date, member_id) do update set deleted_at = excluded.deleted_at;

  -- 사람을 지우면 출석 기록도 함께 지워져요 (on delete cascade)
  delete from public.members m where m.id = p_member_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
--  목장 '완료' / '수정'
-- ---------------------------------------------------------------------

-- 기간(양 끝 포함)의 목장 완료 상태
create or replace function public.am_get_group_days(p_code text, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  return coalesce((
    select jsonb_agg(public.am__group_day_json(d) order by d.date, d.group_id)
    from public.group_days d
    where d.date >= coalesce(p_from, '0001-01-01'::date)
      and d.date <= coalesce(p_to,   '9999-12-31'::date)
  ), '[]'::jsonb);
end;
$$;

-- 완료 / 수정 시작
--  p_action = 'complete': 완료 전 → 완료 (notify 'done'), 수정 중 → 완료 (notify 'edited', 수정 횟수 +1),
--                         이미 완료 → 그대로 (notify null)
--  p_action = 'edit':     완료 → 수정 중. 그 밖에는 그대로
--  돌려주는 값: {"ok": true, "notify": 'done' | 'edited' | null, "pushToken": 알림 열쇠 | null, "day": 바뀐 뒤 상태 | null}
--  pushToken: notify 가 있을 때 새로 만드는 한 번 쓰는 열쇠. 앱은 이것을 알림 함수(am-notify)에 넘겨요(비밀번호 대신).
--             이미 완료된 목장에 다시 '완료'가 오면(답이 끊겨 다시 보낸 경우 등) 아직 안 쓴 열쇠를 그대로 돌려줘요.
--  두 사람이 동시에 눌러도 하나씩 처리해서, 알림은 한 번만 나가요.
create or replace function public.am_set_group_day(p_code text, p_date date, p_group_id uuid, p_action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v        text;
  r        public.group_days;
  v_found  boolean;
  v_notify text;
  v_token  text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null or p_group_id is null or p_action is null or p_action not in ('complete', 'edit') then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_group_day'), hashtext(p_date::text || ':' || p_group_id::text));
  select * into r from public.group_days d where d.date = p_date and d.group_id = p_group_id for update;
  v_found := found;

  if p_action = 'complete' then
    if not v_found then
      v_token := encode(gen_random_bytes(24), 'hex');
      insert into public.group_days (date, group_id, state, done_at, edit_count, push_token, push_token_at, updated_at)
      values (p_date, p_group_id, 'done', now(), 0, v_token, now(), now())
      returning * into r;
      v_notify := 'done';
    elsif r.state = 'editing' then
      v_token := encode(gen_random_bytes(24), 'hex');
      update public.group_days d
         set state = 'done', done_at = now(), edit_count = d.edit_count + 1,
             push_token = v_token, push_token_at = now(), updated_at = now()
       where d.date = p_date and d.group_id = p_group_id
      returning * into r;
      v_notify := 'edited';
    elsif r.push_token is not null and r.push_token_at > now() - interval '10 minutes' then
      -- 이미 완료: 새 열쇠는 만들지 않아요 (먼저 받은 기기의 열쇠가 쓸모없어지지 않도록)
      v_token := r.push_token;
    end if;
  elsif v_found and r.state = 'done' then
    -- 수정 시작: 아직 안 쓴 알림 열쇠는 버려요 (수정 완료 때 새로 만들어요)
    update public.group_days d
       set state = 'editing', push_token = null, push_token_at = null, updated_at = now()
     where d.date = p_date and d.group_id = p_group_id
    returning * into r;
  end if;

  return jsonb_build_object(
    'ok',        true,
    'notify',    v_notify,
    'pushToken', v_token,
    'day',       case when v_found or v_notify is not null then public.am__group_day_json(r) end
  );
end;
$$;

-- 이 기기에서 Web Push 받기 (같은 주소면 열쇠만 새로). 최대 300대, 넘으면 오래된 것부터 정리.
-- 앱을 열 때마다 updated_at 이 새로 바뀌므로, 60일 넘게 한 번도 안 연 기기(안 쓰는 브라우저)는 정리해요
-- (한 휴대폰의 크롬·삼성 인터넷에 둘 다 남아 알림이 두 번 오는 일을 줄여요. 다시 열면 바로 다시 등록돼요)
create or replace function public.am_save_push_sub(p_code text, p_endpoint text, p_keys jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_endpoint is null
     or p_endpoint !~ '^https://[^[:space:]]+$'
     or length(p_endpoint) > 1000
     or jsonb_typeof(p_keys) is distinct from 'object'
     or coalesce(p_keys ->> 'p256dh', '') !~ '^[A-Za-z0-9_+/=-]{20,200}$'
     or coalesce(p_keys ->> 'auth', '') !~ '^[A-Za-z0-9_+/=-]{8,100}$' then
    return jsonb_build_object('error', 'invalid');
  end if;

  insert into public.push_subs (endpoint, keys, created_at, updated_at)
  values (p_endpoint, jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth'), now(), now())
  on conflict (endpoint) do update
    set keys       = excluded.keys,
        updated_at = excluded.updated_at;

  delete from public.push_subs s where s.updated_at < now() - interval '60 days';

  delete from public.push_subs s
  where s.endpoint in (select x.endpoint from public.push_subs x order by x.updated_at desc offset 300);

  return jsonb_build_object('ok', true);
end;
$$;

-- 이 기기 Web Push 그만 받기 (알림 끄기, 또는 서버 함수가 없어진 주소를 정리할 때)
create or replace function public.am_delete_push_sub(p_code text, p_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  delete from public.push_subs s where s.endpoint = p_endpoint;

  return jsonb_build_object('ok', true);
end;
$$;

-- 예전 버전의 '보낼 곳' 함수(공용 비밀번호를 받던 것)는 지워요
drop function if exists public.am_push_targets(text, text, date, uuid);

-- Web Push 보낼 곳 (서버 함수 am-notify 만 부를 수 있어요. 앱(anon)은 못 불러요)
--  공용 비밀번호는 받지 않아요. 완료할 때 am_set_group_day 가 만든 한 번 쓰는 열쇠(p_token)가 맞을 때만,
--  열쇠를 만든 지 10분 안이고 그 완료를 아직 알리지 않았을 때만 돌려줘요. 쓰고 나면 열쇠는 지워요.
--  알림 문구(완료/수정, 목장 이름, 수정 횟수)도 앱이 보낸 값이 아니라 서버 기록으로 정해요.
--  p_exclude_endpoint: 완료를 누른 기기 (자기에게는 보내지 않도록)
--  돌려주는 값: 보낼 곳 | {"error": "invalid"} (값이 빠짐) | {"error": "denied"} (열쇠가 틀림·지남·이미 보냄·수정 중)
create or replace function public.am_push_targets(p_date date, p_group_id uuid, p_token text, p_exclude_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r      public.group_days;
  v_name text;
begin
  if p_date is null or p_group_id is null or p_token is null or length(p_token) not between 16 and 200 then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_group_day'), hashtext(p_date::text || ':' || p_group_id::text));
  select * into r from public.group_days d where d.date = p_date and d.group_id = p_group_id for update;
  if not found
     or r.push_token is null
     or r.push_token is distinct from p_token
     or r.push_token_at is null
     or r.push_token_at < now() - interval '10 minutes'
     or r.state <> 'done'
     or r.done_at is null
     or r.done_at < now() - interval '10 minutes'
     or (r.pushed_at is not null and r.pushed_at >= r.done_at) then
    return jsonb_build_object('error', 'denied');
  end if;

  -- 한 번 쓰면 끝: 보낸 시각을 남기고 열쇠는 지워요
  update public.group_days d
     set pushed_at = now(), push_token = null, push_token_at = null
   where d.date = p_date and d.group_id = p_group_id;
  select g.name into v_name from public.groups g where g.id = p_group_id;

  return jsonb_build_object(
    'ok',      true,
    'kind',    case when r.edit_count > 0 then 'edited' else 'done' end,
    'group',   coalesce(v_name, ''),
    'groupId', r.group_id,
    'date',    to_char(r.date, 'YYYY-MM-DD'),
    'n',       r.edit_count,
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys) order by s.updated_at desc)
      from public.push_subs s
      where s.endpoint is distinct from p_exclude_endpoint
    ), '[]'::jsonb)
  );
end;
$$;

-- 없어진 휴대폰의 Web Push 구독 지우기 (서버 함수 am-notify 만 불러요.
--  휴대폰 회사 알림 서버가 "없는 주소(404/410)"라고 답한 주소만 지워요. 공용 비밀번호는 받지 않아요)
create or replace function public.am_push_forget(p_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  delete from public.push_subs s where s.endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
--  청년회 캘린더 (일정 + 회의록)
--  · 일정이 없거나 지운 일정이면 {"error": "not_found"}
--  · 값이 이상하면(제목 1~60자, 끝 날짜 >= 시작 날짜, 최대 60일, 8가지 색) {"error": "invalid"}
--  · 회의록이 너무 크면(약 300KB) {"error": "too_big"}
-- ---------------------------------------------------------------------

-- 일정 한 줄 → 앱이 쓰는 모양 (hasNote: 회의록에 글이 있는지)
create or replace function public.am__event_json(e public.events)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id',        e.id,
    'title',     e.title,
    'startDate', to_char(e.start_date, 'YYYY-MM-DD'),
    'endDate',   to_char(e.end_date, 'YYYY-MM-DD'),
    'color',     e.color,
    'hasNote',   exists (select 1 from public.event_notes n where n.event_id = e.id and n.plain_len > 0),
    'updatedAt', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

revoke all on function public.am__event_json(public.events) from public, anon, authenticated;

-- 지우지 않은 일정 전부 (한 해 50개 안팎)
create or replace function public.am_get_events(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;

  return coalesce((
    select jsonb_agg(public.am__event_json(e) order by e.start_date, e.end_date desc, e.created_at, e.id)
    from public.events e
    where e.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

-- 일정 추가·수정 (id 가 같으면 덮어쓰기)
--  p_event: {"id", "title", "startDate": "YYYY-MM-DD", "endDate", "color"}
--  돌려주는 값: {"ok": true, "event": 저장된 일정}
--  지운 일정(되돌리기 전)은 고치지 않고 {"error": "not_found"} 를 돌려줘요.
create or replace function public.am_save_event(p_code text, p_event jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v       text;
  v_id    uuid;
  v_title text;
  v_start date;
  v_end   date;
  v_color text;
  r       public.events;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if jsonb_typeof(p_event) is distinct from 'object'
     or coalesce(p_event ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(p_event ->> 'startDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(p_event ->> 'endDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('error', 'invalid');
  end if;

  -- 앞뒤 빈칸(줄바꿈 포함)은 빼고 봐요
  v_title := regexp_replace(coalesce(p_event ->> 'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_color := p_event ->> 'color';
  v_id    := (p_event ->> 'id')::uuid;
  begin
    v_start := (p_event ->> 'startDate')::date;
    v_end   := (p_event ->> 'endDate')::date;
  exception when others then
    -- 2027-02-30 같은 없는 날짜
    return jsonb_build_object('error', 'invalid');
  end;

  if char_length(v_title) not between 1 and 60
     or v_color is null
     or v_color not in ('pink', 'peach', 'butter', 'mint', 'sky', 'lavender', 'lilac', 'aqua')
     or v_start < '2000-01-01'::date
     or v_end > '2100-12-31'::date
     or v_end < v_start
     or v_end - v_start > 59 then
    return jsonb_build_object('error', 'invalid');
  end if;

  -- 지운 일정은 덮어쓰지 않아요 (where 에 걸리면 아무 줄도 돌려주지 않아요)
  insert into public.events as e (id, title, start_date, end_date, color, updated_at, created_at)
  values (v_id, v_title, v_start, v_end, v_color, now(), now())
  on conflict (id) do update
    set title      = excluded.title,
        start_date = excluded.start_date,
        end_date   = excluded.end_date,
        color      = excluded.color,
        updated_at = excluded.updated_at
    where e.deleted_at is null
  returning * into r;

  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'event', public.am__event_json(r));
end;
$$;

-- 일정 지우기 (회의록도 같이 안 보여요). 이미 지웠어도 ok.
--  30일 안에는 am_restore_event 로 되돌릴 수 있어요. 지운 지 30일이 지난 일정은 여기서 회의록과 함께 정리해요.
create or replace function public.am_delete_event(p_code text, p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_id is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  update public.events e
     set deleted_at = now(), updated_at = now()
   where e.id = p_id and e.deleted_at is null;

  -- 회의록은 on delete cascade 로 같이 지워져요
  delete from public.events e where e.deleted_at < now() - interval '30 days';

  return jsonb_build_object('ok', true);
end;
$$;

-- 지운 일정 되돌리기 (회의록도 다시 보여요). 지우지 않은 일정이면 그대로 ok.
--  아예 없거나 30일이 지나 정리된 일정이면 {"error": "not_found"}
create or replace function public.am_restore_event(p_code text, p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_id is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  update public.events e
     set deleted_at = null, updated_at = now()
   where e.id = p_id and e.deleted_at is not null;

  if not found and not exists (select 1 from public.events e where e.id = p_id) then
    return jsonb_build_object('error', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- 회의록 읽기: {"doc", "version", "updatedAt"}. 아직 아무도 안 썼으면 {"doc": null, "version": 0, "updatedAt": null}
create or replace function public.am_get_event_note(p_code text, p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
  n public.event_notes;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_id is null then
    return jsonb_build_object('error', 'invalid');
  end if;
  if not exists (select 1 from public.events e where e.id = p_id and e.deleted_at is null) then
    return jsonb_build_object('error', 'not_found');
  end if;

  select * into n from public.event_notes x where x.event_id = p_id;
  if not found then
    return jsonb_build_object('doc', null, 'version', 0, 'updatedAt', null);
  end if;

  return jsonb_build_object(
    'doc',       n.doc,
    'version',   n.version,
    'updatedAt', to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- 회의록 저장
--  p_base: 고치기 시작할 때 받은 판 번호 (아직 없던 회의록이면 0). -1 이면 판 번호를 보지 않고 덮어써요('내 것으로 저장').
--  서버 판이 p_base 와 같으면 저장하고 판 번호 +1 → {"ok": true, "version", "updatedAt"}
--  그사이 다른 기기가 먼저 저장했으면 저장하지 않고 최신 내용을 같이 돌려줘요
--    → {"error": "conflict", "doc", "version", "updatedAt"}
--  새 회의록에 두 기기가 동시에 처음 저장해도 하나는 ok, 하나는 conflict 가 돼요.
create or replace function public.am_save_event_note(p_code text, p_id uuid, p_doc jsonb, p_plain_len integer, p_base integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
  n public.event_notes;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_id is null
     or jsonb_typeof(p_doc) is distinct from 'object'
     or (p_doc ->> 'type') is distinct from 'doc'
     or p_plain_len is null or p_plain_len < 0
     or p_base is null or p_base < -1 then
    return jsonb_build_object('error', 'invalid');
  end if;
  if octet_length(p_doc::text) > 300000 then
    return jsonb_build_object('error', 'too_big');
  end if;

  -- 일정을 잡아 둬요 (저장하는 사이 다른 기기가 일정을 지우면, 지우기는 이 저장이 끝난 뒤에 돼요)
  perform 1 from public.events e where e.id = p_id and e.deleted_at is null for share;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  select * into n from public.event_notes x where x.event_id = p_id for update;
  if not found then
    if p_base in (-1, 0) then
      insert into public.event_notes (event_id, doc, plain_len, version, updated_at)
      values (p_id, p_doc, p_plain_len, 1, now())
      on conflict (event_id) do nothing
      returning * into n;
      if found then
        return jsonb_build_object(
          'ok',        true,
          'version',   n.version,
          'updatedAt', to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        );
      end if;
    end if;
    -- 다른 기기가 방금 먼저 넣었어요 → 그 줄을 잡고 아래에서 판 번호를 비교해요
    select * into n from public.event_notes x where x.event_id = p_id for update;
    if not found then
      -- 앱은 판 번호가 있다고 알고 있는데 서버에는 회의록이 없어요 (정리된 경우 등)
      return jsonb_build_object('error', 'conflict', 'doc', null, 'version', 0, 'updatedAt', null);
    end if;
  end if;

  if p_base <> -1 and n.version <> p_base then
    return jsonb_build_object(
      'error',     'conflict',
      'doc',       n.doc,
      'version',   n.version,
      'updatedAt', to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  update public.event_notes x
     set doc = p_doc, plain_len = p_plain_len, version = x.version + 1, updated_at = now()
   where x.event_id = p_id
  returning * into n;

  return jsonb_build_object(
    'ok',        true,
    'version',   n.version,
    'updatedAt', to_char(n.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- ---------------------------------------------------------------------
--  목장보고서 (매주 목장마다 PDF 하나)
--  · 파일은 Supabase Storage 의 비공개 보관함(버킷) 'am-reports' 에 두고, 표에는 목록만 적어요.
--  · 앱은 보관함에 직접 들어갈 수 없어요. 아래 am_report_ 함수가 비밀번호를 확인한 뒤
--    그 파일 하나만, 15분 동안 쓸 수 있는 '허락표'(file_tickets)를 만들어 줘요.
--    보관함 규칙(storage.objects 정책)은 이 허락표가 있을 때만 올리기·받기·지우기를 허락해요.
--  · 파일 경로에는 무작위 uuid 가 들어 있어서 추측할 수 없어요.
--  · 마감된 주는 올리기·지우기를 막아요 → {"error": "closed"}
--  · 1년(371일) 지난 주의 보고서는 마감할 때 목록에서 빼고, 앱이 그 파일을 지우게 해요.
--    (Supabase 는 SQL 로 storage.objects 를 바로 지우는 것을 막아서, 앱이 Storage API 로 지워요)
--  · 마감·올리기·지우기는 같은 주일끼리 하나씩 처리해요(잠금). 마감한 뒤에 도착한 올리기는 'closed' 가 돼요.
-- ---------------------------------------------------------------------

-- 목장이 낸 보고서 (주일·목장마다 하나. 다시 올리면 새 파일로 바뀌어요)
--  path: 보관함 안 경로 'reports/<주일>/<목장 id>/<무작위 uuid>.pdf'
create table if not exists public.report_files (
  date        date not null,
  group_id    uuid not null references public.groups (id),
  path        text not null,
  file_name   text not null,
  pages       integer not null default 0,
  size_bytes  integer not null default 0,
  uploaded_at timestamptz not null default now(),
  primary key (date, group_id)
);
create index if not exists report_files_path_idx on public.report_files (path);

-- 주일별 마감 (줄이 없거나 closed_at 이 비어 있으면 마감 전)
create table if not exists public.report_weeks (
  date       date primary key,
  closed_at  timestamptz,
  updated_at timestamptz not null default now()
);

-- 보관함 허락표 (짧은 시간만 유효. upload = 올리기, read = 받기, delete = 지우기)
create table if not exists public.file_tickets (
  path       text not null,
  kind       text not null check (kind in ('upload', 'read', 'delete')),
  expires_at timestamptz not null,
  primary key (path, kind)
);
create index if not exists file_tickets_expires_idx on public.file_tickets (expires_at);

alter table public.report_files enable row level security;
alter table public.report_weeks enable row level security;
alter table public.file_tickets enable row level security;
revoke all on table public.report_files, public.report_weeks, public.file_tickets from public, anon, authenticated;

-- 보관함 규칙이 부르는 확인: 이 경로에 이 종류의 유효한 허락표가 있는지 (예/아니요만 알려 줘요)
--  보관함(Storage)은 앱(anon) 권한으로 규칙을 확인하므로 anon 도 부를 수 있어야 해요.
--  경로는 추측할 수 없는 무작위 이름이라, 예/아니요 말고는 아무것도 알 수 없어요.
create or replace function public.am__ticket_ok(p_name text, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_name is not null
     and p_kind in ('upload', 'read', 'delete')
     and exists (
       select 1 from public.file_tickets t
       where t.path = p_name and t.kind = p_kind and t.expires_at > now()
     );
$$;

revoke all on function public.am__ticket_ok(text, text) from public, anon, authenticated;
grant execute on function public.am__ticket_ok(text, text) to anon, authenticated;

-- 허락표 주기 (이미 있으면 더 늦게 끝나는 쪽으로)
create or replace function public.am__ticket_give(p_paths text[], p_kind text, p_minutes integer)
returns void
language sql
volatile
set search_path = public, extensions
as $$
  insert into public.file_tickets as t (path, kind, expires_at)
  select distinct u.p, p_kind, now() + make_interval(mins => p_minutes)
  from unnest(p_paths) as u(p)
  where u.p is not null
  on conflict (path, kind) do update set expires_at = greatest(t.expires_at, excluded.expires_at);
$$;

-- 끝난 지 1시간 지난 허락표 정리 (am_report_ 함수들이 가끔 불러요)
create or replace function public.am__tickets_gc()
returns void
language sql
volatile
set search_path = public, extensions
as $$
  delete from public.file_tickets t where t.expires_at < now() - interval '1 hour';
$$;

-- 이 함수(주인 권한)가 storage.objects 를 빠짐없이 볼 수 있는지.
--  Supabase 의 postgres 는 보통 RLS 를 건너뛸 수 있어요(bypassrls). 못 보면 '파일이 있는지' 확인은 건너뛰어요
--  (RLS 에 가려 못 보는 것을 '파일이 없다'로 잘못 판단하지 않도록)
create or replace function public.am__can_see_storage()
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select to_regclass('storage.objects') is not null
     and exists (select 1 from pg_roles r where r.rolname = current_user and (r.rolsuper or r.rolbypassrls));
$$;

-- 보고서 한 줄 → 앱이 쓰는 모양
create or replace function public.am__report_json(f public.report_files)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'groupId',    f.group_id,
    'path',       f.path,
    'fileName',   f.file_name,
    'pages',      f.pages,
    'sizeBytes',  f.size_bytes,
    'uploadedAt', to_char(f.uploaded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

revoke all on function public.am__ticket_give(text[], text, integer)  from public, anon, authenticated;
revoke all on function public.am__tickets_gc()                         from public, anon, authenticated;
revoke all on function public.am__can_see_storage()                    from public, anon, authenticated;
revoke all on function public.am__report_json(public.report_files)     from public, anon, authenticated;

-- 보관함 'am-reports' 만들기 + 규칙 (Storage 가 없는 일반 PostgreSQL 에서는 건너뛰어요)
--  비공개, 파일 하나 최대 45MB, PDF 만.
--  규칙 이름은 am_reports_ 로 시작해요. 다시 Run 하면 지우고 새로 만들어요.
--  · 올리기(insert): 올리기 허락표가 있는 경로만
--  · 보기(select):  받기·올리기·지우기 허락표가 있는 경로만
--    (올린 직후 결과를 돌려받을 때, 지울 때도 Storage 가 '보기' 규칙을 함께 확인해요)
--  · 지우기(delete): 지우기 허락표가 있는 경로만
--  · 덮어쓰기(update) 규칙은 만들지 않아요 → 이미 있는 파일은 바꿀 수 없어요
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice '목장보고서: storage 스키마가 없어서 보관함(am-reports) 만들기를 건너뛰어요 (Supabase 가 아닌 서버)';
    return;
  end if;

  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('am-reports', 'am-reports', false, 47185920, '{application/pdf}'::text[])
    on conflict (id) do update
      set public             = false,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
  $sql$;

  execute 'drop policy if exists am_reports_insert on storage.objects';
  execute 'drop policy if exists am_reports_select on storage.objects';
  execute 'drop policy if exists am_reports_delete on storage.objects';

  execute $sql$
    create policy am_reports_insert on storage.objects
      for insert to anon
      with check (bucket_id = 'am-reports' and public.am__ticket_ok(name, 'upload'))
  $sql$;
  execute $sql$
    create policy am_reports_select on storage.objects
      for select to anon
      using (
        bucket_id = 'am-reports'
        and (public.am__ticket_ok(name, 'read')
             or public.am__ticket_ok(name, 'upload')
             or public.am__ticket_ok(name, 'delete'))
      )
  $sql$;
  execute $sql$
    create policy am_reports_delete on storage.objects
      for delete to anon
      using (bucket_id = 'am-reports' and public.am__ticket_ok(name, 'delete'))
  $sql$;
end
$$;

-- 그 주일의 마감 여부와 낸 보고서 (목장 순서대로)
--  돌려주는 값: {"date", "closedAt": 마감 시각 | null, "files": [{groupId, path, fileName, pages, sizeBytes, uploadedAt}]}
create or replace function public.am_get_reports(p_code text, p_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v        text;
  v_closed timestamptz;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  select w.closed_at into v_closed from public.report_weeks w where w.date = p_date;

  return jsonb_build_object(
    'date',     to_char(p_date, 'YYYY-MM-DD'),
    'closedAt', to_char(v_closed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'files',    coalesce((
      select jsonb_agg(public.am__report_json(f) order by g.sort_order, g.name, f.group_id)
      from public.report_files f
      left join public.groups g on g.id = f.group_id
      where f.date = p_date
    ), '[]'::jsonb)
  );
end;
$$;

-- 올리기 시작: 새 경로와 15분짜리 올리기 허락표를 줘요 → {"ok": true, "path"}
--  마감된 주면 {"error": "closed"}, 없거나 지운 목장이면 {"error": "no_group"}
--  앱은 이 경로로 Storage 에 올린 뒤 am_report_commit 을 불러요.
create or replace function public.am_report_begin(p_code text, p_date date, p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v      text;
  v_path text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null or p_group_id is null
     or p_date < '2000-01-01'::date or p_date > '2100-12-31'::date then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_report'), hashtext(p_date::text));

  -- 마감된 주, 그리고 1년 넘게 지난 주(마감할 때 정리되는 주)는 더 못 올려요
  if p_date < current_date - 371
     or exists (select 1 from public.report_weeks w where w.date = p_date and w.closed_at is not null) then
    return jsonb_build_object('error', 'closed');
  end if;
  if not exists (select 1 from public.groups g where g.id = p_group_id and not g.archived) then
    return jsonb_build_object('error', 'no_group');
  end if;

  perform public.am__tickets_gc();
  -- 끝나지 않은 올리기 허락표가 너무 많으면 잠시 쉬어요 (실수로 계속 누르는 경우 등)
  if (select count(*) from public.file_tickets t where t.kind = 'upload' and t.expires_at > now()) >= 200 then
    return jsonb_build_object('error', 'busy');
  end if;

  v_path := 'reports/' || to_char(p_date, 'YYYY-MM-DD') || '/' || p_group_id::text || '/' || gen_random_uuid()::text || '.pdf';
  perform public.am__ticket_give(array[v_path], 'upload', 15);

  return jsonb_build_object('ok', true, 'path', v_path);
end;
$$;

-- 올리기 마치기: Storage 에 올린 파일을 그 목장의 보고서로 적어요
--  돌려주는 값: {"ok": true, "file": 보고서, "oldPath": 예전 파일 경로 | null}
--  예전 파일이 있었으면 그 경로에 지우기 허락표를 주고, 앱이 지워요.
--  마감된 주면 {"error": "closed", "orphan": 방금 올린 경로} (앱이 지우도록 지우기 허락표를 줘요)
--  그 밖의 오류: invalid(값이 이상함), expired(올리기 허락표가 없거나 오래됨), no_group, not_uploaded(파일이 없음)
--  같은 요청을 다시 보내도(답이 끊겨 다시 보낸 경우) 이미 적혀 있으면 그대로 ok.
create or replace function public.am_report_commit(
  p_code text, p_date date, p_group_id uuid, p_path text, p_file_name text, p_pages integer, p_size integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v         text;
  v_prefix  text;
  v_name    text;
  v_old     text;
  v_found   boolean;
  v_ticket  boolean;
  v_checked boolean := false;
  v_exists  boolean := false;
  v_size    bigint;
  r         public.report_files;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null or p_group_id is null or p_path is null
     or p_pages is null or p_pages < 0 or p_pages > 5000
     or p_size is null or p_size < 0 then
    return jsonb_build_object('error', 'invalid');
  end if;
  v_prefix := 'reports/' || to_char(p_date, 'YYYY-MM-DD') || '/' || p_group_id::text || '/';
  if left(p_path, length(v_prefix)) <> v_prefix
     or substr(p_path, length(v_prefix) + 1) !~ '^[0-9a-f-]{36}\.pdf$' then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_report'), hashtext(p_date::text));

  select * into r from public.report_files f where f.date = p_date and f.group_id = p_group_id for update;
  v_found := found;
  if v_found and r.path = p_path then
    -- 이미 적혀 있어요 (같은 요청을 다시 보냄)
    delete from public.file_tickets t where t.path = p_path and t.kind = 'upload';
    return jsonb_build_object('ok', true, 'file', public.am__report_json(r), 'oldPath', null);
  end if;
  v_old := case when v_found then r.path end;

  -- 올리기 허락표: 끝난 지 30분까지는 봐줘요 (큰 파일을 느린 인터넷으로 올린 경우)
  v_ticket := exists (
    select 1 from public.file_tickets t
    where t.path = p_path and t.kind = 'upload' and t.expires_at > now() - interval '30 minutes'
  );

  -- 마감됐거나 목장이 없어졌으면: 방금 올린 파일은 앱이 지우도록 지우기 허락표를 줘요
  if exists (select 1 from public.report_weeks w where w.date = p_date and w.closed_at is not null) then
    v := 'closed';
  elsif not exists (select 1 from public.groups g where g.id = p_group_id and not g.archived) then
    v := 'no_group';
  elsif not v_ticket then
    return jsonb_build_object('error', 'expired');
  end if;
  if v <> 'ok' then
    if v_ticket then
      delete from public.file_tickets t where t.path = p_path and t.kind = 'upload';
      perform public.am__ticket_give(array[p_path], 'delete', 15);
      return jsonb_build_object('error', v, 'orphan', p_path);
    end if;
    return jsonb_build_object('error', v);
  end if;

  -- 파일이 정말 올라갔는지 Storage 목록에서 확인해요 (볼 수 없는 서버면 건너뛰어요)
  begin
    if public.am__can_see_storage() then
      select true,
             case when o.metadata ->> 'size' ~ '^[0-9]{1,12}$' then (o.metadata ->> 'size')::bigint end
        into v_exists, v_size
        from storage.objects o
       where o.bucket_id = 'am-reports' and o.name = p_path;
      v_exists := coalesce(v_exists, false);
      v_checked := true;
    end if;
  exception when others then
    v_checked := false;
    v_exists := false;
    v_size := null;
  end;
  if v_checked and not v_exists then
    return jsonb_build_object('error', 'not_uploaded');
  end if;

  -- 파일 이름: 보이지 않는 글자는 빼고, 앞뒤 빈칸 정리, 최대 200자
  v_name := regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g');
  v_name := left(regexp_replace(v_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 200);
  if v_name = '' then
    v_name := '보고서.pdf';
  end if;

  insert into public.report_files as f (date, group_id, path, file_name, pages, size_bytes, uploaded_at)
  values (p_date, p_group_id, p_path, v_name, p_pages, least(coalesce(v_size, p_size), 2147483647)::integer, now())
  on conflict (date, group_id) do update
    set path        = excluded.path,
        file_name   = excluded.file_name,
        pages       = excluded.pages,
        size_bytes  = excluded.size_bytes,
        uploaded_at = excluded.uploaded_at
  returning * into r;

  delete from public.file_tickets t where t.path = p_path and t.kind = 'upload';
  if v_old is not null and v_old <> p_path then
    perform public.am__ticket_give(array[v_old], 'delete', 15);
  else
    v_old := null;
  end if;

  insert into public.report_weeks as w (date, updated_at) values (p_date, now())
  on conflict (date) do update set updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'file', public.am__report_json(r), 'oldPath', v_old);
end;
$$;

-- 낸 보고서 지우기 (마감 전만) → {"ok": true, "path": 지울 파일 경로 | null}
--  앱이 그 경로의 파일을 지우도록 지우기 허락표를 줘요. 이미 없으면 path 는 null.
create or replace function public.am_report_delete(p_code text, p_date date, p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v      text;
  v_path text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null or p_group_id is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_report'), hashtext(p_date::text));

  if exists (select 1 from public.report_weeks w where w.date = p_date and w.closed_at is not null) then
    return jsonb_build_object('error', 'closed');
  end if;

  delete from public.report_files f
   where f.date = p_date and f.group_id = p_group_id
  returning f.path into v_path;

  perform public.am__tickets_gc();
  if v_path is not null then
    perform public.am__ticket_give(array[v_path], 'delete', 15);
    update public.report_weeks w set updated_at = now() where w.date = p_date;
  end if;

  return jsonb_build_object('ok', true, 'path', v_path);
end;
$$;

-- 파일 받기·보기 허락 (15분): 목록에 있는 경로만, 한 번에 최대 60개 → {"ok": true, "paths": 허락한 경로}
create or replace function public.am_report_read(p_code text, p_paths text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v       text;
  v_paths text[];
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_paths is null or coalesce(cardinality(p_paths), 0) > 60 then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform public.am__tickets_gc();

  select array_agg(distinct f.path) into v_paths
  from public.report_files f
  where f.path = any (p_paths);

  if v_paths is not null then
    perform public.am__ticket_give(v_paths, 'read', 15);
  end if;

  return jsonb_build_object('ok', true, 'paths', to_jsonb(coalesce(v_paths, '{}'::text[])));
end;
$$;

-- 마감하기 (이미 마감됐으면 처음 마감 시각 그대로) → {"ok": true, "closedAt", "prune": 지울 파일 경로들}
--  마감하는 김에 정리도 해요: 1년(371일) 지난 주의 보고서는 목록에서 빼고(한 번에 300개까지),
--  어느 목록에도 없는 하루 넘은 파일(올리다 끊긴 것 등, 200개까지)도 찾아서, 앱이 지우도록 지우기 허락표를 줘요.
create or replace function public.am_report_close(p_code text, p_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v         text;
  v_closed  timestamptz;
  v_prune   text[];
  v_orphans text[];
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null or p_date < '2000-01-01'::date or p_date > '2100-12-31'::date then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_report'), hashtext(p_date::text));

  insert into public.report_weeks as w (date, closed_at, updated_at)
  values (p_date, now(), now())
  on conflict (date) do update
    set closed_at  = coalesce(w.closed_at, excluded.closed_at),
        updated_at = excluded.updated_at
  returning w.closed_at into v_closed;

  perform public.am__tickets_gc();

  -- 1년 지난 보고서 정리 (오래된 것부터)
  with old as (
    select f.date, f.group_id
    from public.report_files f
    where f.date < current_date - 371
    order by f.date
    limit 300
  ), del as (
    delete from public.report_files f
    using old
    where f.date = old.date and f.group_id = old.group_id
    returning f.path
  )
  select array_agg(del.path) into v_prune from del;

  -- 마감 표시는 남겨요 (한 주에 한 줄이라 작아요). 지우면 그 주가 다시 '마감 전'이 돼서 올릴 수 있게 돼요
  delete from public.report_weeks w
   where w.date < current_date - 371
     and w.closed_at is null
     and not exists (select 1 from public.report_files f where f.date = w.date);

  -- 목록에 없는 파일 찾기 (Storage 목록을 볼 수 없는 서버면 건너뛰어요)
  begin
    if public.am__can_see_storage() then
      select array_agg(x.name) into v_orphans
      from (
        select o.name
        from storage.objects o
        where o.bucket_id = 'am-reports'
          and o.created_at < now() - interval '1 day'
          and not exists (select 1 from public.report_files f where f.path = o.name)
        order by o.created_at
        limit 200
      ) x;
    end if;
  exception when others then
    v_orphans := null;
  end;

  v_prune := coalesce(v_prune, '{}'::text[]) || coalesce(v_orphans, '{}'::text[]);
  if cardinality(v_prune) > 0 then
    perform public.am__ticket_give(v_prune, 'delete', 15);
  end if;

  return jsonb_build_object(
    'ok',       true,
    'closedAt', to_char(v_closed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'prune',    to_jsonb(v_prune)
  );
end;
$$;

-- 마감 풀기 (실수로 마감했을 때) → {"ok": true}
create or replace function public.am_report_reopen(p_code text, p_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v text;
begin
  v := public.am__verify(p_code);
  if v <> 'ok' then
    return jsonb_build_object('error', v);
  end if;
  if p_date is null then
    return jsonb_build_object('error', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('am_report'), hashtext(p_date::text));

  update public.report_weeks w
     set closed_at = null, updated_at = now()
   where w.date = p_date and w.closed_at is not null;

  return jsonb_build_object('ok', true);
end;
$$;

-- 앱(anon)에게는 위 am_ 함수만 열어 줘요
revoke all on function public.am_login(text)                                    from public;
revoke all on function public.am_change_passcode(text, text)                    from public;
revoke all on function public.am_get_roster(text)                               from public;
revoke all on function public.am_get_attendance(text, date, date)               from public;
revoke all on function public.am_get_attendance_changes(text, timestamptz, date) from public;
revoke all on function public.am_get_week_notes(text, date, date)               from public;
revoke all on function public.am_save_attendance(text, jsonb)                   from public;
revoke all on function public.am_clear_attendance(text, date, uuid)             from public;
revoke all on function public.am_save_week_note(text, jsonb)                    from public;
revoke all on function public.am_save_groups(text, jsonb)                       from public;
revoke all on function public.am_save_members(text, jsonb)                      from public;
revoke all on function public.am_import_roster(text, jsonb, jsonb)              from public;
revoke all on function public.am_purge_member(text, uuid)                       from public;
revoke all on function public.am_get_group_days(text, date, date)               from public;
revoke all on function public.am_set_group_day(text, date, uuid, text)          from public;
revoke all on function public.am_save_push_sub(text, text, jsonb)               from public;
revoke all on function public.am_delete_push_sub(text, text)                    from public;
revoke all on function public.am_get_events(text)                               from public;
revoke all on function public.am_save_event(text, jsonb)                        from public;
revoke all on function public.am_delete_event(text, uuid)                       from public;
revoke all on function public.am_restore_event(text, uuid)                      from public;
revoke all on function public.am_get_event_note(text, uuid)                     from public;
revoke all on function public.am_save_event_note(text, uuid, jsonb, integer, integer) from public;
revoke all on function public.am_get_reports(text, date)                        from public;
revoke all on function public.am_report_begin(text, date, uuid)                 from public;
revoke all on function public.am_report_commit(text, date, uuid, text, text, integer, integer) from public;
revoke all on function public.am_report_delete(text, date, uuid)                from public;
revoke all on function public.am_report_read(text, text[])                      from public;
revoke all on function public.am_report_close(text, date)                       from public;
revoke all on function public.am_report_reopen(text, date)                      from public;
revoke all on function public.am_push_targets(date, uuid, text, text)           from public, anon, authenticated;
revoke all on function public.am_push_forget(text)                              from public, anon, authenticated;

grant execute on function public.am_login(text)                                    to anon, authenticated;
grant execute on function public.am_change_passcode(text, text)                    to anon, authenticated;
grant execute on function public.am_get_roster(text)                               to anon, authenticated;
grant execute on function public.am_get_attendance(text, date, date)               to anon, authenticated;
grant execute on function public.am_get_attendance_changes(text, timestamptz, date) to anon, authenticated;
grant execute on function public.am_get_week_notes(text, date, date)               to anon, authenticated;
grant execute on function public.am_save_attendance(text, jsonb)                   to anon, authenticated;
grant execute on function public.am_clear_attendance(text, date, uuid)             to anon, authenticated;
grant execute on function public.am_save_week_note(text, jsonb)                    to anon, authenticated;
grant execute on function public.am_save_groups(text, jsonb)                       to anon, authenticated;
grant execute on function public.am_save_members(text, jsonb)                      to anon, authenticated;
grant execute on function public.am_import_roster(text, jsonb, jsonb)              to anon, authenticated;
grant execute on function public.am_purge_member(text, uuid)                       to anon, authenticated;
grant execute on function public.am_get_group_days(text, date, date)               to anon, authenticated;
grant execute on function public.am_set_group_day(text, date, uuid, text)          to anon, authenticated;
grant execute on function public.am_save_push_sub(text, text, jsonb)               to anon, authenticated;
grant execute on function public.am_delete_push_sub(text, text)                    to anon, authenticated, service_role;
grant execute on function public.am_get_events(text)                               to anon, authenticated;
grant execute on function public.am_save_event(text, jsonb)                        to anon, authenticated;
grant execute on function public.am_delete_event(text, uuid)                       to anon, authenticated;
grant execute on function public.am_restore_event(text, uuid)                      to anon, authenticated;
grant execute on function public.am_get_event_note(text, uuid)                     to anon, authenticated;
grant execute on function public.am_save_event_note(text, uuid, jsonb, integer, integer) to anon, authenticated;
grant execute on function public.am_get_reports(text, date)                        to anon, authenticated;
grant execute on function public.am_report_begin(text, date, uuid)                 to anon, authenticated;
grant execute on function public.am_report_commit(text, date, uuid, text, text, integer, integer) to anon, authenticated;
grant execute on function public.am_report_delete(text, date, uuid)                to anon, authenticated;
grant execute on function public.am_report_read(text, text[])                      to anon, authenticated;
grant execute on function public.am_report_close(text, date)                       to anon, authenticated;
grant execute on function public.am_report_reopen(text, date)                      to anon, authenticated;
grant execute on function public.am_push_targets(date, uuid, text, text)           to service_role;
grant execute on function public.am_push_forget(text)                              to service_role;

-- 서버(API)가 새 함수를 바로 알아보도록
notify pgrst, 'reload schema';

-- =====================================================================
--  급할 때 쓰는 명령 (필요할 때만 한 줄씩 골라 SQL Editor 에서 실행하세요)
-- =====================================================================
--  비밀번호를 잊었을 때 → 0000 으로 되돌리기
--    update public.app_settings set value = extensions.crypt('0000', extensions.gen_salt('bf')) where key = 'passcode_hash';
--
--  비밀번호를 여러 번 틀려서 잠겼을 때 → 바로 풀기
--    delete from public.login_attempts;
--
--  어떤 주일의 목장 '완료'를 모두 '완료 전'으로 되돌리기 (날짜를 바꿔서)
--    delete from public.group_days where date = '2026-11-15';
--
--  지운 지 30일이 안 된 일정 되살리기 (제목을 바꿔서)
--    update public.events set deleted_at = null where title = '볼링대회';
--
--  실수로 마감한 목장보고서 주를 다시 열기 (날짜를 바꿔서. 앱의 '마감 풀기'와 같아요)
--    update public.report_weeks set closed_at = null where date = '2026-11-22';
--
--  어떤 주일에 낸 목장보고서 보기 (날짜를 바꿔서)
--    select g.name as 목장, f.file_name as 파일, f.pages as 쪽, f.uploaded_at as 올린때 from public.report_files f join public.groups g on g.id = f.group_id where f.date = '2026-11-22' order by g.sort_order;
--
--  한 목장의 보고서를 '안 냄'으로 되돌리기 (목장 이름·날짜를 바꿔서. 파일은 Storage → am-reports 에서 따로 지워도 돼요)
--    delete from public.report_files where date = '2026-11-22' and group_id = (select id from public.groups where name = '사랑' limit 1);
--
--  목장보고서 올리기·받기가 '허락'이 없다고 계속 실패할 때 → 허락표 비우기 (앱에서 다시 누르면 새로 만들어요)
--    delete from public.file_tickets;
--
--  지금 들어 있는 인원 확인
--    select (select count(*) from public.groups) as 목장, (select count(*) from public.members) as 사람, (select count(*) from public.attendance) as 출석기록;
-- =====================================================================
