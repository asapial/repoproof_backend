-- Administrative control only; run with the approved migration role.
-- No product Run, evidence, verdict or fixture is executed by this SQL.
-- First installation only. Existing schemas cause a safe transaction failure.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA sandbox_control;
REVOKE ALL ON SCHEMA sandbox_control FROM PUBLIC;
CREATE TABLE sandbox_control.smoke (
  singleton smallint PRIMARY KEY CHECK (singleton = 1),
  state text NOT NULL DEFAULT 'HOLD' CHECK (state IN ('HOLD', 'APPROVED', 'CONSUMED')),
  admin_id text NOT NULL,
  project_id text NOT NULL,
  team_id text NOT NULL,
  image text NOT NULL,
  node_version text NOT NULL,
  plan text NOT NULL CHECK (plan = 'HOBBY'),
  paid_usage boolean NOT NULL DEFAULT false CHECK (paid_usage = false),
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at <= checked_at + interval '5 minutes'),
  cpu_seconds_remaining integer NOT NULL CHECK (cpu_seconds_remaining >= 0),
  memory_gib_seconds_remaining integer NOT NULL CHECK (memory_gib_seconds_remaining >= 0),
  creations_remaining integer NOT NULL CHECK (creations_remaining >= 0),
  transfer_bytes_remaining bigint NOT NULL CHECK (transfer_bytes_remaining >= 0),
  consumed_at timestamptz,
  cleanup_confirmed boolean NOT NULL DEFAULT false
);
CREATE FUNCTION sandbox_control.prevent_rearm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'CONSUMED' AND (NEW.state <> 'CONSUMED' OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'Smoke permission is consumed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER smoke_no_rearm BEFORE UPDATE ON sandbox_control.smoke
FOR EACH ROW EXECUTE FUNCTION sandbox_control.prevent_rearm();
REVOKE ALL ON FUNCTION sandbox_control.prevent_rearm() FROM PUBLIC;
REVOKE ALL ON sandbox_control.smoke FROM PUBLIC;
COMMIT;
-- No row or grants by default. See docs/SANDBOX_PREPARATION.md.
