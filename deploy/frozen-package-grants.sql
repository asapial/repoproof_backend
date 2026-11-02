\set ON_ERROR_STOP on
SELECT current_database()=:'approved_database' AS correct_database \gset
\if :correct_database
\else
  SELECT 1 / 0;
\endif
SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname=:'package_role'
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
  AND NOT pg_has_role(r.oid,current_user,'MEMBER')
  AND NOT pg_has_role(r.oid,'pg_read_all_data','MEMBER') AND NOT pg_has_role(r.oid,'pg_write_all_data','MEMBER')
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
  AND NOT has_table_privilege(r.oid,'public."user"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."Run"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."ExecutionReplayGroup"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."ExecutionJob"','SELECT')
  AND NOT has_table_privilege(r.oid,'public."ExecutionReconciliation"','SELECT')
  AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid AND c.relnamespace='public'::regnamespace
    AND c.relname='FrozenPreparationPackage')
) AS limited_role \gset
\if :limited_role
\else
  SELECT 1 / 0;
\endif
BEGIN;
GRANT CONNECT ON DATABASE :"approved_database" TO :"package_role";
GRANT USAGE ON SCHEMA public TO :"package_role";
REVOKE CREATE ON SCHEMA public FROM :"package_role";
REVOKE ALL ON public."FrozenPreparationPackage" FROM :"package_role";
GRANT SELECT,INSERT ON public."FrozenPreparationPackage" TO :"package_role";
ALTER ROLE :"package_role" SET statement_timeout='3s';
ALTER ROLE :"package_role" SET lock_timeout='2s';
ALTER ROLE :"package_role" SET idle_in_transaction_session_timeout='5s';
COMMIT;
-- Internal trusted preparation store only. No HTTP, patcher, job or provider role.
