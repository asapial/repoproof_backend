\set ON_ERROR_STOP on
-- Operator supplies approved_database and a NEW limited runtime_role.
SELECT current_database() = :'approved_database' AS target_ok \gset
\if :target_ok
\else
  \echo Refusing unapproved database
  SELECT 1 / 0; -- ON_ERROR_STOP must return a nonzero process exit.
\endif
SELECT EXISTS (
  SELECT 1 FROM pg_roles r WHERE r.rolname = :'runtime_role'
    AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND NOT pg_has_role(r.oid, current_user, 'MEMBER')
    AND NOT pg_has_role(r.oid, 'pg_read_all_data', 'MEMBER')
    AND NOT pg_has_role(r.oid, 'pg_write_all_data', 'MEMBER')
) AS limited_role_ok \gset
\if :limited_role_ok
\else
  \echo Refusing missing or privileged runtime role
  SELECT 1 / 0;
\endif
BEGIN;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
GRANT CONNECT ON DATABASE :"approved_database" TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."user", public."session", public."account", public."verification", public."RequestDraft", public."AuthRateBucket"
  TO :"runtime_role";
-- Safe history metadata only. Raw run/evidence tables remain inaccessible.
GRANT EXECUTE ON FUNCTION public.repoproof_history_v1(text, timestamptz, text, integer) TO :"runtime_role";
ALTER ROLE :"runtime_role" SET statement_timeout = '5s';
ALTER ROLE :"runtime_role" SET lock_timeout = '5s';
ALTER ROLE :"runtime_role" SET idle_in_transaction_session_timeout = '10s';
COMMIT;
-- No grants on migrations, runs, approvals, frozen tests or evidence tables.
