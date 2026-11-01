import { Pool } from "pg";
import { databasePoolOptions } from "../lib/databasePool";
import type { SmokeConfig } from "./policy";

export interface SmokeControl {
  claim(config: SmokeConfig, adminId: string): Promise<boolean>;
  finish(cleaned: boolean): Promise<void>;
}

// One globally consumable row, never automatically replenished or expired open.
// A lost process or uncertain create/stop leaves it consumed across all instances.
export class PostgresSmokeControl implements SmokeControl {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ ...databasePoolOptions(databaseUrl), max: 1 });
    this.pool.on("error", () => { /* Fail closed; never log connection strings. */ });
  }
  async claim(config: SmokeConfig, adminId: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE sandbox_control.smoke SET state = 'CONSUMED', consumed_at = clock_timestamp()
      WHERE singleton = 1 AND state = 'APPROVED' AND admin_id = $1 AND project_id = $2 AND team_id = $3
      AND image = $4 AND node_version = $5 AND plan = 'HOBBY' AND paid_usage = false
      AND checked_at <= clock_timestamp() AND checked_at > clock_timestamp() - interval '5 minutes'
      AND expires_at > clock_timestamp() AND expires_at <= checked_at + interval '5 minutes'
      AND cpu_seconds_remaining >= 60 AND memory_gib_seconds_remaining >= 120
      AND creations_remaining >= 2 AND transfer_bytes_remaining >= 2097152
      RETURNING singleton`, [adminId, config.projectId, config.teamId, config.image, config.nodeVersion]);
    return result.rowCount === 1;
  }
  async finish(cleaned: boolean): Promise<void> {
    // Status only; never re-arm the permission, even after a confirmed stop.
    await this.pool.query("UPDATE sandbox_control.smoke SET cleanup_confirmed = $1 WHERE singleton = 1 AND state = 'CONSUMED'", [cleaned]);
  }
  async close(): Promise<void> { await this.pool.end(); }
}
