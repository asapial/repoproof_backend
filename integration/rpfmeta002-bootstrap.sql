\set ON_ERROR_STOP on
SELECT current_database()='rpf_engine_disposable' AND current_user='rpf_test'
  AND current_setting('is_superuser')='on' AS owned_test_environment \gset
\if :owned_test_environment
\else
  SELECT 1 / 0;
\endif
SELECT 'CREATE ROLE rpf_engine_meta_accounting LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rpf_engine_meta_accounting') \gexec
SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rpf_engine_meta_accounting' AND NOT rolsuper
  AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)) AS limited_identity \gset
\if :limited_identity
\else
  SELECT 1 / 0;
\endif
