# Neon Free PostgreSQL preparation

Current release also includes RPF-SEC-006's additive fourth migration,
AuthRateBucket. Apply all four migrations before updated runtime-grants.sql.
The three-migration backup/restore evidence below remains historical RPF-DB-001
evidence, not a claim about the later schema. See DEPLOYMENT_PACKAGE.md.

RPF-DB-001 is local preparation. No Neon account, project, branch, role,
database, paid setting or network resource has been created or changed.

## Runtime and migration credentials

`DATABASE_URL` belongs to a limited runtime role and uses Neon's pooled
endpoint. `DIRECT_URL` belongs only to the migration operator/job and uses the
direct endpoint. Prisma CLI prefers DIRECT_URL; local compatibility falls back
to DATABASE_URL. Generation works with neither value and opens no connection.
Invalid explicit DIRECT_URL values fail without exposing them. Do not install
migration-owner credentials in the Vercel runtime environment.

Runtime pg options force certificate verification for remote hosts and reject
TLS downgrades, file-based SSL options and URL options that could bypass
resource bounds. The URL SSL settings are removed before pg can override the
explicit secure options. Only synthetic loopback tests permit plaintext.
Channel binding enables SCRAM-PLUS when offered by the driver/server; live
Neon negotiation remains unverified. Two connections, 5-second connection/query
waits and idle release remain bounded. Actual Neon TLS, DNS, pooling and wake
from suspension require provider credentials and external acceptance.

## Limited role procedure, after infrastructure approval

Use the migration owner to create a **new limited role through SQL** with a
separately generated strong password supplied through protected tooling.
Neon Console/API-created roles inherit neon_superuser privileges; they are
unsuitable as the limited runtime role. Never grant runtime membership in the
owner, neon_superuser, pg_read_all_data or pg_write_all_data roles.

After backing up and confirming the exact database, apply reviewed migrations
with DIRECT_URL using `prisma migrate deploy`, check status and repeat deploy.
Do not use reset, migrate dev, db push or seeding for deployment. Run
`deploy/runtime-grants.sql` using psql with `approved_database` and `runtime_role`
set to the reviewed names. Identifier quoting prevents SQL interpolation. The
script refuses a different database or privileged role, removes grants only
from that **named role**, permits authentication/draft DML, and sets statement,
lock and idle-transaction deadlines. It grants no migration, run, frozen-test
or evidence access and no blanket privileges on future tables. Re-review the
grant list when a separately approved feature adds an active table.

The SQL is a privilege change. Do not apply it to another existing role or
database without its owner's approval. Migration ownership, runtime password,
URL identity, effective memberships and privilege rejection must be checked
on actual Neon before traffic is allowed.

## Manual backup, restore and rollback

Neon's Free history is short. Keep a separate encrypted/offline custom-format
pg_dump backup before migrations or release. Use the direct endpoint, an
appropriate pg client version, verified TLS and a protected PGPASSFILE; put
host/user/database in environment names, never passwords in commands, logs or
Git. Write to a new backup path and record its checksum, source identity,
schema version and access restrictions. Do not overwrite old backups.

Restore with pg_restore `--no-owner --no-acl --exit-on-error` into a **new empty
approved database/branch**, using the migration owner. Reapply the explicit
runtime grants and verify migration status, constraints/triggers, counts and
two-user application behavior before switching runtime configuration. Do not
restore over existing user data or assume migrations reverse automatically.
Application rollback uses prior exact artifacts and compatible schema. A data
restore/switch needs explicit approval for its data-loss implications. Keep
the previous branch/artifact/backup until the owner accepts recovery.

## Actual local evidence

The new disposable PostgreSQL 16 database `rpf_db001_disposable` received all
three migrations from scratch, status and repeat deploy through DIRECT_URL,
while DATABASE_URL pointed to a restricted role. The limited role could not
create a table, read migrations/evidence, insert a run or assume the owner.
Actual HTTP two-user auth/draft isolation, malicious owner-field rejection,
database constraint rejection, zero product runs and recovery after terminating
an owned database connection passed. Cleanup removed only users created by the
test. The primary synthetic database and unrelated earlier test rows remained.

A real pg_dump/pg_restore into a separate empty `rpf_restore_disposable`
retained three migrations, 48 constraints, 17 triggers and synthetic constraint
test rows. Live restored immutability rejection passed. PostgreSQL flattened
one associative AND expression during dump/reparse; its own parser confirmed
equivalence instead of deleting parentheses from the comparison. These are
synthetic SQL tests, not product execution or verification evidence.

The initial grant script's psql 16 `quit` argument returned zero; fixed guards
now fail with a nonzero exit before changes. Wrong-database and privileged-role
negative tests passed. Node24 full quality: 105 tests, lint, types, builds and
zero full/production audits. Exact commands/results are in parent
`output/predeployment-2026-11-01/evidence/db001-*`; failed attempts are retained.

## Zero-cost limits checked November 1, 2026

Current official Free limits include 100 CU-hours/project/month, 1 GB database
storage/project (20 GB account total), 5 GB public egress/project/month,
10 branches/project, a 6-hour history window capped at 1 GB of changes and one
manual snapshot. Scale-to-zero follows five minutes of inactivity. Use a small
compute, no continuous readiness polling, no replicas, conservative usage
alerts/manual checks and no paid upgrade. Do not replace the existing app auth
with Neon's managed auth product. Recheck actual account entitlements before
approval; quotas are not performance or availability guarantees.

References: [current plans](https://neon.com/docs/introduction/plans),
[Prisma](https://neon.com/docs/guides/prisma),
[role privileges](https://neon.com/docs/manage/roles),
[PostgreSQL backup](https://www.postgresql.org/docs/current/backup-dump.html).
