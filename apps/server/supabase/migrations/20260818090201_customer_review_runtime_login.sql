-- @req FR-078 — dedicated login for the bounded customer-review runtime.
-- @spec ADR-018 D3, ADR-033 D8, SEC-010 — migration/admin identity is never
-- the application runtime identity; the login has no direct base-table grants.
-- @tested tests/unit/customer-review-runtime-login-migration.test.js

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:customer-review:runtime-login:v1'));

do $precondition_guard$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_app_runtime') then
    raise exception 'CUSTOMER_REVIEW_RUNTIME_LOGIN_PRECONDITION_FAILED: zuri_app_runtime is missing';
  end if;
end
$precondition_guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_customer_review_login') then
    create role zuri_customer_review_login login noinherit nobypassrls
      nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$roles$;

do $role_security_guard$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'zuri_customer_review_login'
      and (rolsuper or rolinherit or rolcreaterole or rolcreatedb or not rolcanlogin
        or rolreplication or rolbypassrls)
  ) then
    raise exception 'CUSTOMER_REVIEW_RUNTIME_LOGIN_SECURITY_MISMATCH: login role is privileged or cannot login';
  end if;
end
$role_security_guard$;

revoke all on schema zuri_core from zuri_customer_review_login;
revoke all on all tables in schema zuri_core from zuri_customer_review_login;
revoke all on all sequences in schema zuri_core from zuri_customer_review_login;
revoke all on all functions in schema zuri_core from zuri_customer_review_login;

grant zuri_app_runtime to zuri_customer_review_login
  with inherit false, set true, admin false;

do $membership_guard$
begin
  if not exists (
    select 1
    from pg_auth_members member
    join pg_roles granted_role on granted_role.oid = member.roleid
    join pg_roles login_role on login_role.oid = member.member
    where granted_role.rolname = 'zuri_app_runtime'
      and login_role.rolname = 'zuri_customer_review_login'
      and member.inherit_option = false
      and member.set_option = true
      and member.admin_option = false
  ) then
    raise exception 'CUSTOMER_REVIEW_RUNTIME_LOGIN_MEMBERSHIP_MISMATCH: login cannot set bounded runtime role';
  end if;
end
$membership_guard$;

comment on role zuri_customer_review_login is
  'FR-078 server-only customer review login; no direct zuri_core grants; SET LOCAL ROLE zuri_app_runtime required.';

commit;
