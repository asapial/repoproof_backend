\set ON_ERROR_STOP on
SELECT current_database()='rpf012s_disposable' AND current_user='rpf_test'
  AND current_setting('is_superuser')='on' AS owned_test_environment \gset
\if :owned_test_environment
\else
  SELECT 1 / 0;
\endif
SELECT 'CREATE DATABASE rpf_engine_disposable OWNER rpf_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='rpf_engine_disposable') \gexec
SELECT 'CREATE ROLE rpf_engine_replay LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rpf_engine_replay') \gexec
SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='rpf_engine_replay'
  AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
  AND EXISTS(SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
    WHERE d.datname='rpf_engine_disposable' AND r.rolname='rpf_test') AS expected_identities \gset
\if :expected_identities
\else
  SELECT 1 / 0;
\endif
-- Local/CI trust-auth synthetic identities only. Never reset/delete existing data.
