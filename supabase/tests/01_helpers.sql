-- Test helpers (assertions, identity switching, a scratch key/value store).
create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;

create table if not exists tests.vars (k text primary key, v text);
grant all on tests.vars to authenticated, anon, service_role;

create or replace function tests.setv(p_k text, p_v text) returns text language sql as $$
  insert into tests.vars values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v
$$;
create or replace function tests.v(p_k text) returns text language sql stable as $$
  select v from tests.vars where k = p_k
$$;
create or replace function tests.u(p_k text) returns uuid language sql stable as $$
  select v::uuid from tests.vars where k = p_k
$$;

create or replace function tests.claims(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
$$;

create or replace function tests.eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'ASSERT FAILED [%]: got %, want %', label, got, want;
  end if;
end $$;

create or replace function tests.ok(label text, cond boolean) returns void
language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERT FAILED [%]', label; end if;
end $$;

-- Runs sql and requires that it raises an error whose message matches pattern (case-insensitive).
create or replace function tests.throws(label text, sql text, pattern text default '') returns void
language plpgsql as $$
declare msg text;
begin
  begin
    execute sql;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg !~* pattern then
      raise exception 'ASSERT FAILED [%]: error "%" does not match "%"', label, msg, pattern;
    end if;
    return;
  end;
  raise exception 'ASSERT FAILED [%]: expected an error, none raised', label;
end $$;

grant execute on all functions in schema tests to authenticated, anon, service_role;

-- Test users
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner@a.test', '{"full_name":"Owner A"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'staff@a.test', '{"full_name":"Staff A"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cust1@a.test', '{"full_name":"Anjali"}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'cust2@a.test', '{"full_name":"Bhavya"}'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'finance@a.test', '{"full_name":"Accountant A"}'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'owner@b.test', '{"full_name":"Owner B"}');
