# Approval-gated owned Vercel Sandbox smoke — RPF-SBX-002

Prepared only; zero live sandboxes. RPF-004 remains IN_PROGRESS. SDK observations
are explicitly UNVERIFIED_SDK_OBSERVATION and cannot establish isolation, genuine
assertion failure, provenance authenticity or a VERIFIED verdict. No Run/report
is inserted and `/runs` remains 503. Historical RPF-004 work is preserved in its
original dirty worktree; it provides offline policy ideas, not a deployed runner.

## Exact initial live scope (not authorized yet)

One authenticated admin session and exact web Origin; one owned discount-bug pin
1066351c5b07bed024775a16af9151048a9316b2; three SHA-256 checked fixture files;
one immutable approved VCR image with exact Node24 patch. No user repository,
generated patch/test, Git clone, mounts, application environment or credentials
inside the VM. One sandbox only, 1 CPU/2048 MB, deny-all network, persistent=false,
no ports and 30-second provider lifetime. No snapshots, resumes, timeout extension,
package install, shell, root/sudo or model call. Initial account/concurrency and
fresh Hobby quota checks must meet SANDBOX_PREPARATION.md's durable one-shot gate.

The existing admin harness stays unregistered and disabled. Approval must name
the actual Hobby account/project/team, image digest, admin, region, quota record,
operator executor and $0 policy. Keys go in secret storage, never chat/Git/guest.
The ordinary Vercel API deployment excludes fixture bytes; it is not the operator
executor. A foreground trusted executor must stay alive through cleanup and
persist the receipt. No HTTP response followed by fire-and-forget execution.

## Commands and receipt

The controller pins one SDK Session. File writes, commands and stop address that
same VM; parent automatic resume must never recreate execution. Fixed commands:

1. Exact Node patch check.
2. Uploaded source/test SHA-256 check.
3. Existing issue test (expected exit 1).
4. Existing regression test (expected exit 0).
5. Repeat exact file hashes.

Each command is limited to 5 seconds; total operation 20 seconds, separate cleanup
5 seconds. Output across the session is limited to 16 KiB. Raw stdout/stderr are
discarded; per-stream byte counts/SHA-256, exact argv digest, command ID, start/end
timestamps and returned exit code are captured. An interrupted command has a null
exit code, never a guessed success. Exit 1 alone is not an assertion proof: this
smoke does not parse test assertions or produce verdicts.

The typed receipt includes unique observation ID, fixture pin/manifest hash,
requested policy hash, actual SDK sandbox name/session ID/image/policy/resources/
lifetime/creation timestamp, command records and stop attempt/ack timestamps.
Metadata policy mismatch prevents uploading code. Unexpected snapshots or a stop
for another session cannot confirm cleanup. Admin logs retain only fixed status,
command count and cleanup boolean; receipt/provider IDs stay out of ordinary logs.

Store the validated receipt and SHA-256 in an approved append-only durable
operator evidence store, bound to approval and invocation IDs. This ticket returns
the structured receipt; it does not yet implement that durable controller/store.
An independent observer must query the actual provider identity/state and collect
its own timestamps. A fabricated JSON receipt or SDK mock must never satisfy it.

## Cleanup and failure

Every path attempts stop, including late create resolution. Cancellation uses an
independent cleanup signal. The one-shot permission stays consumed on success,
timeout, process loss, unknown create or stop, and cannot automatically rearm.
The provider TTL is a secondary bound, not acknowledged cleanup proof. Network
partitions/process termination can prevent confirmation; label UNKNOWN and
quarantine further work. Reconcile actual provider inventory before any next
approval. Never automatically repeat an uncertain create or promise cleanup based
only on a callback that may die with a Function invocation.

## Independent acceptance still required

After the smoke, separate owned negative probes must establish external/private/
metadata/IPv4/IPv6 network boundaries, secret/filesystem/cross-sandbox separation,
resources/timeouts/cancel/cleanup, no persistence, authenticated provenance and
failure-path behavior. Independent authenticated observations and controller
signatures must bind image/source/commands/output hashes to the real session.
RPF-004 cannot finish from this smoke or mocks.

Initial concurrency one permits serial clean-sandbox/nonpersistence checks. A
simultaneous cross-sandbox isolation test needs a separate explicit two-sandbox
exception and fresh quota approval. Do not silently raise concurrency or waive
the mandatory cross-sandbox gate. Its plan/harness is separate eligible work.

SDK semantics checked against installed 3.9.1 and current official
[reference](https://vercel.com/docs/sandbox/sdk-reference),
[quotas](https://vercel.com/docs/sandbox/pricing) and
[persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).
All real account, image, runtime, policy and destruction checks remain pending.
