\set ON_ERROR_STOP on
-- This file is only for a newly owned local/CI PostgreSQL service.
SELECT current_database() = 'rpf012s_disposable' AND current_user = 'rpf_test' AS test_target_ok \gset
\if :test_target_ok
\else
  \echo Refusing non-disposable test bootstrap
  SELECT 1 / 0; -- psql 16 does not support an exit code on \quit.
\endif
SELECT 'CREATE ROLE rpf_runtime_predeploy LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rpf_runtime_predeploy') \gexec
SELECT 'CREATE DATABASE rpf_db001_disposable OWNER rpf_test'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'rpf_db001_disposable') \gexec
