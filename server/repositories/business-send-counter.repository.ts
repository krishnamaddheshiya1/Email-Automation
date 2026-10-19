import fs from "fs";
import path from "path";
import { query, isDbConfigured } from "../db/client";
import type { QueryResultRow } from "pg";

export interface SendCounterRecord {
  business_id: string;
  period_type: "daily" | "hourly";
  period_key: string;
  count: number;
  created_at: string;
  updated_at: string;
}

class LocalSendCounterStore {
  private static filePath = path.resolve(process.cwd(), ".data/business_send_counters.json");
  private static cache: Map<string, number> | null = null;

  private static key(businessId: string, periodType: string, periodKey: string): string {
    return `${businessId}:${periodType}:${periodKey}`;
  }

  private static load(): Map<string, number> {
    if (this.cache !== null) return this.cache;
    this.cache = new Map();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.cache.set(k, Number(v) || 0);
        }
      }
    } catch {
      // Ignore read error
    }
    return this.cache;
  }

  private static save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj: Record<string, number> = {};
      for (const [k, v] of this.cache!.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not save to local send counter store:", err);
    }
  }

  static get(businessId: string, periodType: string, periodKey: string): number {
    const map = this.load();
    return map.get(this.key(businessId, periodType, periodKey)) || 0;
  }

  static increment(businessId: string, periodType: string, periodKey: string, amount = 1): number {
    const map = this.load();
    const k = this.key(businessId, periodType, periodKey);
    const nextVal = (map.get(k) || 0) + amount;
    map.set(k, nextVal);
    this.save();
    return nextVal;
  }

  static reset(businessId: string, periodType: string, periodKey: string): void {
    const map = this.load();
    map.delete(this.key(businessId, periodType, periodKey));
    this.save();
  }
}

export class BusinessSendCounterRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  async getCount(
    businessId: string,
    periodType: "daily" | "hourly",
    periodKey: string
  ): Promise<number> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT count FROM business_send_counters
          WHERE business_id = $1 AND period_type = $2 AND period_key = $3;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, periodType, periodKey]);
        if (res.rows.length > 0) {
          return Number(res.rows[0].count || 0);
        }
        return 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    return LocalSendCounterStore.get(businessId, periodType, periodKey);
  }

  async increment(
    businessId: string,
    periodType: "daily" | "hourly",
    periodKey: string,
    amount = 1
  ): Promise<number> {
    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO business_send_counters (business_id, period_type, period_key, count, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (business_id, period_type, period_key)
          DO UPDATE SET count = business_send_counters.count + EXCLUDED.count, updated_at = NOW()
          RETURNING count;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [businessId, periodType, periodKey, amount]);
        const newCount = Number(res.rows[0]?.count || 0);
        LocalSendCounterStore.increment(businessId, periodType, periodKey, amount);
        return newCount;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    return LocalSendCounterStore.increment(businessId, periodType, periodKey, amount);
  }

  async reset(
    businessId: string,
    periodType: "daily" | "hourly",
    periodKey: string
  ): Promise<void> {
    if (this.useDatabase()) {
      try {
        await this.queryFn(
          `DELETE FROM business_send_counters WHERE business_id = $1 AND period_type = $2 AND period_key = $3;`,
          [businessId, periodType, periodKey]
        );
        LocalSendCounterStore.reset(businessId, periodType, periodKey);
        return;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    LocalSendCounterStore.reset(businessId, periodType, periodKey);
  }
}
