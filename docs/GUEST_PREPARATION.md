# Owned guest filesystem preparation

RPF-GUEST-001 prepares exact admitted snapshot bytes in a fresh guest directory.
It never executes/evaluates/imports those files, creates a process, calls a provider
or grants execution authority. The unregistered helper lives under the existing
protected `src/sandbox/` boundary; model patch proposals reject its path before
catalog/provider access. Original fixture, task and runner-policy bytes stay intact.

`encodeGuestPreparation` requires the private prepared-snapshot handle. Its bounded
canonical packet includes a fresh UUID, phase, frozen manifest/snapshot digests,
four fixed paths, exact base64 bytes and static admission counts. Decoding clones
bytes, rejects duplicate/unknown/noncanonical keys or base64, wrong order/paths,
hash/length/count mismatch and unsupported AST. Baseline source and both original
test files must match pinned fixture hashes; patched source remains narrow AST.
Recomputed seals must match the whole snapshot digest. Static counts are not
executed assertion counts. A packet alone is not an authentic frozen capability.

## Guest-only filesystem requirements

The runtime must be non-root Linux, expose no-follow/directory/nonblocking flags,
and mount procfs at `/proc` (Linux PROC_SUPER_MAGIC). Missing support fails closed;
there is no Windows/path-check fallback. Descriptor-relative child operations use
`/proc/self/fd/<held-fd>/<fixed-name>`. Root `/` and `/vercel` must be root-owned,
without group/other write permission; `/vercel/sandbox` must belong to the non-root
runtime UID. Every directory component is opened with NOFOLLOW/DIRECTORY/NONBLOCK.
Only exact safely represented device/inode/UID values are compared; imprecise
numeric identities fail rather than permit an ambiguous match.

A new `rpf-prepared-<uuid>` directory and `src`/`tests` children are created
exclusively with mode 0700. Existing names are rejected, never reused or removed.
Each file uses CREAT/EXCL/NOFOLLOW/NONBLOCK. Before writing it must be a zero-length
regular file owned by the expected UID on the same device, link count one, mode
0600. Partial writes are bounded by exact content length; zero/invalid progress
fails. Data is synced and files become 0444. The helper reopens by held parent
descriptor, checks inode/device/owner/link/mode/size, reads exactly the expected
bytes plus EOF, compares bytes/hashes, and checks metadata again. Parent/destination
identity is rechecked, directories become 0555, and directory metadata is synced.
Every opened descriptor is closed on success or failure; close errors fail too.

All errors are fixed labels without path/content/driver details. A partial failure
leaves inert bytes in the fresh guest tree and requires whole-guest disposal. No
recursive cleanup, in-place patch, existing-tree rewrite, shell or ambient path is
available. Baseline/patched use separate fresh snapshots; tests are never edited.
Read-only permissions do not defeat a privileged/concurrent writer: a fresh,
quiescent disposable guest and independent mount/process/containment observations
are mandatory. Synchronous filesystem calls require external command/VM termination;
the helper cannot establish hard deadlines, resource enforcement or physical isolation.

Every success says `UNVERIFIED_GUEST_PREPARATION`, `authentic: false`,
`executionAllowed: false`. Its digests are observations, not VERIFIED evidence.
The controller must independently verify complete bytes, helper/image identity,
no unexpected mounts/entries and non-root process policy before any separately
approved execution. Actual Linux race, link, permission, procfs, mount, fsync,
failure-disposal and readback checks remain pending in the approved image.

## Local evidence and future image

Node24 38 focused/full 646 tests in 42 files, lint, source/integration types,
production build, lint-toolchain and zero full/production audits passed. Positive
filesystem paths and 19 faults/attacks use a clearly modeled filesystem, not a real
guest/kernel. Actual Windows Node24 source and compiled deny checks returned
UNSUPPORTED with zero guest filesystem calls and zero fixture execution. No owned
isolation probe or generated/fixture test was executed on the host or Docker.

The first bundle accidentally externalized Babel and failed import; that evidence
is retained. The accepted standalone ESM build includes pinned Babel/Zod and passes
the compiled Windows deny gate. The final helper is 1,265,568 bytes, SHA-256
`e9d363dce7d2a1152b07ba2f0c1f94928b9f958ed69e6aff1d62bd026971de50`,
in local `output/meta-engine-2026-11-02/artifacts/guest001-protected/` with its
manifest and exact build script/logs. No container/image was built or provisioned.
This exceeds the existing smoke fixture upload cap: do not weaken that cap or use
guest dependency downloads. A separately approved image must bake in the exact
trusted helper/dependencies and prove its provenance and runtime behavior first.

[Node filesystem flags/statfs](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags)
and [Linux filesystem constants](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h)
were checked against primary documentation. These API definitions are not actual
Vercel isolation evidence. RPF-004 stays IN_PROGRESS, RPF-006A DEFERRED; parent
RPF-008/009/011B remain incomplete.
