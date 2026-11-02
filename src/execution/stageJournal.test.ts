import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { nextStage, PostgresStageJournal, type StageCommand, type StageRecord, type StageView } from "./stageJournal";

const flowId = "10000000-0000-4000-8000-000000000001", packageId = "30000000-0000-4000-8000-000000000001";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const root: StageRecord = { version: "rpf-stage-journal-v1",mode: "OFFLINE_PREPARATION",flowId,sequence: 0,previousSha256: "0".repeat(64),
  requestHash: "a".repeat(64),deadlineAtMs: 5000,kind: "OPEN",outcome: "NONE",referenceSha256: "a".repeat(64),
  frozenPackageId: null,frozenManifestSha256: null,state: "OPEN",cancelRequested: false };
function command(p: StageRecord, kind: StageCommand["kind"], outcome: StageCommand["outcome"]): StageCommand {
  return { flowId,expectedSequence: p.sequence,expectedRecordSha256: hash(p),kind,outcome,
    referenceSha256: kind === "FREEZE" ? "f".repeat(64) : "b".repeat(64),frozenPackageId: kind === "FREEZE" && outcome === "ALLOWED" ? packageId : p.frozenPackageId,
    frozenManifestSha256: kind === "FREEZE" && outcome === "ALLOWED" ? "f".repeat(64) : p.frozenManifestSha256 };
}
const advance = (p: StageRecord, kind: StageCommand["kind"], outcome: StageCommand["outcome"]) => nextStage(p,command(p,kind,outcome),1000);
function frozen() { return advance(advance(root,"INTAKE","ALLOWED"),"FREEZE","ALLOWED"); }
function fixture() {
  const rows: { payload: Buffer; recordSha256: string; recordedAtMs: number }[] = []; let nowMs = 1000, lost = false;
  const release = vi.fn(), query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql === "COMMIT" && lost) throw new Error("sensitive driver output");
    if (sql.startsWith('INSERT INTO public."ExecutionStageJournal"')) rows.push({ payload: Buffer.from(values[12] as Buffer),recordSha256: values[13] as string,recordedAtMs: nowMs });
    if (sql.includes('FROM public."FrozenPreparationPackage"')) return { rowCount: 1,rows: [{ manifestSha256: "f".repeat(64) }] };
    if (sql.includes('AS "nowMs"')) return { rowCount: 1,rows: [{ nowMs }] };
    return { rowCount: sql.startsWith("SELECT") ? rows.length : 0,rows: sql.startsWith("SELECT") ? rows : [] };
  });
  const connect = vi.fn(async () => ({ query,release })), pool = { connect } as unknown as Pick<Pool,"connect">;
  return { store: new PostgresStageJournal(pool),pool,rows,query,connect,release,setNow: (n: number) => { nowMs = n; },loseAck: () => { lost = true; },restoreAck: () => { lost = false; } };
}
function resultView(result: Awaited<ReturnType<PostgresStageJournal["load"]>>): StageView {
  if (!result.ok || !result.value) throw new Error("Synthetic journal fixture"); return result.value;
}

describe("offline durable multi-stage journal", () => {
  it("enforces complete freeze/fail/regressions/patch/retest ordering without a verdict", () => {
    let p = frozen(); expect(p.state).toBe("FROZEN");
    for (const [kind,outcome,state] of [["BASELINE_ISSUE","ASSERTION_FAILURE","BASELINE_FAILED"],["BASELINE_REGRESSIONS","PASS","BASELINE_CLEAR"],
      ["PATCH_PREPARED","ALLOWED","PATCH_READY"],["PATCHED_ISSUE","PASS","PATCHED_PASS"],["PATCHED_REGRESSIONS","PASS","AWAITING_TRUST_REVIEW"]] as const) {
      p = advance(p,kind,outcome); expect(p.state).toBe(state); expect(p.frozenPackageId).toBe(packageId);
    }
    expect(() => advance(p,"PATCH_PREPARED","ALLOWED")).toThrow();
  });
  it("makes no-repro terminal and prevents all patch transitions", () => {
    const p = advance(frozen(),"BASELINE_ISSUE","PASS"); expect(p.state).toBe("NO_REPRO_PREPARATION");
    for (const kind of ["PATCH_PREPARED","PATCHED_ISSUE","BASELINE_REGRESSIONS","CANCEL","EXPIRE"] as const) expect(() => advance(p,kind,kind === "CANCEL" || kind === "EXPIRE" ? "NONE" : "PASS")).toThrow();
  });
  it.each(["INCONCLUSIVE","UNCERTAIN"] as const)("stops after %s and never rearms quarantine", outcome => {
    const p = advance(frozen(),"BASELINE_ISSUE",outcome); expect(p.state).toBe(outcome === "UNCERTAIN" ? "QUARANTINED" : "INCONCLUSIVE");
    expect(() => advance(p,"BASELINE_ISSUE","PASS")).toThrow(); expect(() => nextStage(p,command(p,"EXPIRE","NONE"),6000)).toThrow();
    if (outcome === "UNCERTAIN") { const c = advance(p,"CANCEL","NONE"); expect(c.state).toBe("QUARANTINED"); expect(c.cancelRequested).toBe(true); expect(() => advance(c,"CANCEL","NONE")).toThrow(); }
  });
  it("rejects patch-before-freeze, skipped baseline/regressions and inconsistent durable test identity", () => {
    const first = advance(root,"INTAKE","ALLOWED"), f = frozen(), failed = advance(f,"BASELINE_ISSUE","ASSERTION_FAILURE");
    for (const p of [root,first,f,failed]) expect(() => advance(p,"PATCH_PREPARED","ALLOWED")).toThrow();
    for (const altered of [{ frozenPackageId: null },{ frozenManifestSha256: null },{ referenceSha256: "0".repeat(64) }]) expect(() => nextStage(first,{ ...command(first,"FREEZE","ALLOWED"),...altered },1000)).toThrow();
    expect(() => nextStage(f,{ ...command(f,"BASELINE_ISSUE","PASS"),frozenPackageId: flowId },1000)).toThrow();
  });
  it("records failure/denial as terminal preparation and prevents regression skipping", () => {
    expect(advance(root,"INTAKE","DENIED").state).toBe("REJECTED_PREPARATION");
    const failed = advance(frozen(),"BASELINE_ISSUE","ASSERTION_FAILURE");
    expect(advance(failed,"BASELINE_REGRESSIONS","ASSERTION_FAILURE").state).toBe("INCONCLUSIVE");
    expect(() => advance(failed,"PATCHED_ISSUE","PASS")).toThrow();
    const clear = advance(failed,"BASELINE_REGRESSIONS","PASS"); expect(advance(clear,"PATCH_PREPARED","DENIED").state).toBe("REJECTED_PREPARATION");
  });
  it("bounds expiry/cancellation and rejects CAS/hash/context changes", () => {
    expect(() => nextStage(root,command(root,"INTAKE","ALLOWED"),5000)).toThrow();
    expect(() => nextStage(root,command(root,"EXPIRE","NONE"),4999)).toThrow();
    expect(nextStage(root,command(root,"EXPIRE","NONE"),5000).state).toBe("EXPIRED");
    expect(advance(root,"CANCEL","NONE").state).toBe("CANCELLED");
    for (const altered of [{ expectedSequence: 1 },{ expectedRecordSha256: "0".repeat(64) },{ flowId: packageId },{ outcome: "NONE" as const }]) expect(() => nextStage(root,{ ...command(root,"INTAKE","ALLOWED"),...altered },1000)).toThrow();
  });
  it("persists/replays stages, recovers original keys after real-looking lost COMMIT and rejects conflicting retry", async () => {
    const h = fixture(); h.loseAck(); expect(await h.store.open({ flowId,requestHash: root.requestHash,deadlineAtMs: 5000 })).toEqual({ ok: false,reason: "UNAVAILABLE" });
    expect(h.connect).toHaveBeenCalledTimes(1); h.restoreAck(); const opened = resultView(await new PostgresStageJournal(h.pool).load(flowId));
    expect(opened).toMatchObject({ dispatchAllowed: false,productionVerdict: "INCONCLUSIVE",record: { mode: "OFFLINE_PREPARATION" } });
    const cmd = command(opened.record,"INTAKE","ALLOWED"); h.loseAck(); expect(await h.store.append(cmd)).toEqual({ ok: false,reason: "UNAVAILABLE" });
    h.restoreAck(); expect(resultView(await h.store.load(flowId)).record.state).toBe("INTAKE_ACCEPTED"); h.setNow(6000);
    expect(resultView(await h.store.append(cmd)).record.state).toBe("INTAKE_ACCEPTED");
    expect(await h.store.append({ ...cmd,outcome: "DENIED" })).toEqual({ ok: true,value: null });
    expect(await h.store.open({ flowId,requestHash: "b".repeat(64),deadlineAtMs: 5000 })).toEqual({ ok: true,value: null });
    expect(h.rows).toHaveLength(2); expect(JSON.stringify(h.store)).toBe('{"store":"postgres-stage-journal"}');
  });
  it.each(["hash","canonical","identity","sequence","transition","time"])("rejects corrupt stored chain %s", async kind => {
    const h = fixture(); await h.store.open({ flowId,requestHash: root.requestHash,deadlineAtMs: 5000 }); const row = h.rows[0]!;
    if (kind === "hash") row.recordSha256 = "0".repeat(64);
    else if (kind === "canonical") row.payload = Buffer.concat([Buffer.from(" "),row.payload]);
    else if (kind === "time") row.recordedAtMs = 6000;
    else { const value = JSON.parse(row.payload.toString()); if (kind === "identity") value.flowId = packageId; if (kind === "sequence") value.sequence = 1;
      if (kind === "transition") value.state = "AWAITING_TRUST_REVIEW"; row.payload = Buffer.from(JSON.stringify(value)); row.recordSha256 = hash(value); }
    expect(await h.store.load(flowId)).toEqual({ ok: false,reason: "UNAVAILABLE" });
  });
  it("rejects malformed commands before connection and bounds unavailable storage", async () => {
    const connect = vi.fn(() => new Promise<PoolClient>(() => {})), store = new PostgresStageJournal({ connect },10);
    expect(await store.load("bad")).toEqual({ ok: false,reason: "INVALID" });
    expect(await store.append({ ...command(root,"INTAKE","ALLOWED"),verdict: "VERIFIED" } as never)).toEqual({ ok: false,reason: "INVALID" }); expect(connect).not.toHaveBeenCalled();
    expect(await store.load(flowId)).toEqual({ ok: false,reason: "UNAVAILABLE" }); expect(connect).toHaveBeenCalledTimes(1);
  });
});
