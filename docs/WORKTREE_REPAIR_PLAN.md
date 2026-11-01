# Stale D: worktree registrations: inspection and repair plan

RPF-HYG-002, November 1, 2026. Inspection only; **no repair, prune, delete,
move, checkout, reset or fixture execution was performed**.

All five directories exist under `I:/Project/RepoProof`, but both their `.git`
files and the registered worktree locations refer to the old D: root. The
backend's matching `.git/worktrees/` records still exist under I:. Reading
status with explicit `--git-dir`, `--work-tree` and `--no-optional-locks`
confirmed the following identities without refreshing their indexes:

| Directory under I:/Project/RepoProof | HEAD | Existing changes |
| --- | --- | --- |
| `.rpf-002-baseline-f56bcb6` | `f56bcb6d6dbae99b0805ac8b6c7162e6994447bc` | none reported |
| `.rpf-002-clean-public-base` | `3d4574720fb12a7833350502716b32b99f7ee619` | none reported |
| `.rpf-002-patched-f56bcb6` | `f56bcb6d6dbae99b0805ac8b6c7162e6994447bc` | modified `fixtures/discount-bug/src/discount.mjs`; preserve exact bytes |
| `.rpf-002-public-candidate` | `1066351c5b07bed024775a16af9151048a9316b2` | none reported; branch `feat/rpf-002-public-fixture` |
| `.rpf-002-public-verified` | `1066351c5b07bed024775a16af9151048a9316b2` | none reported |

The immutable local inspection is
`output/predeployment-2026-11-01/stale-worktrees-inspection.json` in the parent
workspace, SHA-256
`61d422cdc5662df6d76dc67d913bc35e07adc0d21e669be97b5dfeb1760568df`.
`prunable` is a broken-link observation, not permission to discard work.

## Future scoped repair, after approval

1. Stop writers in these five directories. Recheck the exact absolute paths,
   repository object identities, branch tips, `.git` files, metadata HEADs,
   indexes and status. Record hashes of the modified fixture and all untracked
   files. Do not run any fixture script.
2. Back up each directory and the backend Git metadata to new, explicitly
   checked destinations. Preserve indexes and working files, including the
   uncommitted patch. Backups must not overwrite old evidence.
3. From the existing I: backend repository, use Git's `worktree repair` with
   these five explicit I: paths. Do not hand-edit unknown metadata, initialize
   another repository, prune registrations or remove files. Stop on any
   identity mismatch or unexpected branch association.
4. Compare all pre/post HEADs, branch tips, indexes, source hashes and status.
   Confirm ordinary `git -C <path> status --short` works and these five stale
   pointers disappear from `git worktree list --porcelain`. Other worktrees
   must remain unchanged. Keep backups and evidence.

This goal authorizes this plan, not execution of metadata repair. The five
historical checkouts are not release candidates and their old tests are not
fresh release evidence.
