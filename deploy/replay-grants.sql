\set ON_ERROR_STOP on
SELECT current_database() = :'approved_database' AS correct_database \gset
\if :correct_database
\else
  SELECT 1 / 0;
\endif
SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname=:'replay_role'
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
  AND NOT r.rolreplication AND NOT r.rolbypassrls
  AND NOT pg_has_role(r.oid,current_user,'MEMBER')
  AND NOT pg_has_role(r.oid,'pg_read_all_data','MEMBER')
  AND NOT pg_has_role(r.oid,'pg_write_all_data','MEMBER')
  AND NOT has_table_privilege(r.oid,'public."user"','SELECT')
  AND (to_regclass('public."ExecutionStageJournal"') IS NULL
    OR NOT has_table_privilege(r.oid,to_regclass('public."ExecutionStageJournal"'),'INSERT'))
  AND (to_regclass('public."MetaAttemptAccounting"') IS NULL
    OR NOT has_table_privilege(r.oid,to_regclass('public."MetaAttemptAccounting"'),'INSERT'))
  AND (to_regclass('public."ExecutionReconciliation"') IS NULL
    OR NOT has_table_privilege(r.oid,to_regclass('public."ExecutionReconciliation"'),'INSERT'))
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
  AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner=r.oid AND c.relnamespace='public'::regnamespace
    AND c.relname IN ('ExecutionReplayGroup','ExecutionReplayItem'))
) AS limited_role \gset
\if :limited_role
\else
  SELECT 1 / 0;
\endif
BEGIN;
GRANT CONNECT ON DATABASE :"approved_database" TO :"replay_role";
GRANT USAGE ON SCHEMA public TO :"replay_role";
REVOKE CREATE ON SCHEMA public FROM :"replay_role";
REVOKE ALL ON "ExecutionReplayGroup","ExecutionReplayItem" FROM :"replay_role";
GRANT SELECT,INSERT ON "ExecutionReplayGroup","ExecutionReplayItem" TO :"replay_role";
ALTER ROLE :"replay_role" SET statement_timeout='3s';
ALTER ROLE :"replay_role" SET lock_timeout='2s';
ALTER ROLE :"replay_role" SET idle_in_transaction_session_timeout='5s';
COMMIT;
-- No user/session/draft/migration/Run/evidence writes or replay UPDATE/DELETE.
