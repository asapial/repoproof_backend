\set ON_ERROR_STOP on
SELECT current_database()=:'approved_database' AS correct_database \gset
\if :correct_database
\else
  SELECT 1 / 0;
\endif
SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname=:'observer_role'
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
  AND NOT pg_has_role(r.oid,current_user,'MEMBER')
  AND NOT pg_has_role(r.oid,'pg_read_all_data','MEMBER') AND NOT pg_has_role(r.oid,'pg_write_all_data','MEMBER')
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
  AND NOT has_table_privilege(r.oid,'public."user"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."Run"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."ExecutionReplayGroup"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."ExecutionJob"','UPDATE')
  AND NOT has_table_privilege(r.oid,'public."ExecutionEffect"','INSERT')
  AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid AND c.relnamespace='public'::regnamespace
    AND c.relname IN ('ExecutionJob','ExecutionEffect','ExecutionReconciliation'))
) AS limited_role \gset
\if :limited_role
\else
  SELECT 1 / 0;
\endif
BEGIN;
GRANT CONNECT ON DATABASE :"approved_database" TO :"observer_role";
GRANT USAGE ON SCHEMA public TO :"observer_role";
REVOKE CREATE ON SCHEMA public FROM :"observer_role";
REVOKE ALL ON "ExecutionJob","ExecutionEffect","ExecutionReconciliation" FROM :"observer_role";
GRANT SELECT ON "ExecutionJob","ExecutionEffect" TO :"observer_role";
GRANT SELECT,INSERT ON "ExecutionReconciliation" TO :"observer_role";
ALTER ROLE :"observer_role" SET statement_timeout='3s';
ALTER ROLE :"observer_role" SET lock_timeout='2s';
ALTER ROLE :"observer_role" SET idle_in_transaction_session_timeout='5s';
COMMIT;
-- Dedicated reconciliation control plane only, never HTTP/dispatcher credentials.
