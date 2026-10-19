import crypto from "crypto";
import { BaseRepository } from "./base.repository";
import { User } from "@/types/database";
import { query } from "../db/client";

export class UserRepository implements BaseRepository<User, string> {
  async findById(id: string): Promise<User | null> {
    const res = await query<User>("SELECT * FROM users WHERE id = $1;", [id]);
    return res.rows[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const res = await query<User>("SELECT * FROM users WHERE email = $1;", [
      email,
    ]);
    return res.rows[0] || null;
  }

  async findByBusinessId(businessId: string): Promise<User[]> {
    const res = await query<User>(
      "SELECT * FROM users WHERE business_id = $1 ORDER BY created_at ASC;",
      [businessId]
    );
    return res.rows;
  }

  async findAll(): Promise<User[]> {
    const res = await query<User>(
      "SELECT * FROM users ORDER BY created_at DESC;"
    );
    return res.rows;
  }

  async create(data: Omit<User, "id"> & { id?: string }): Promise<User> {
    const userId = data.id || crypto.randomUUID();
    const res = await query<User>(
      `INSERT INTO users (id, business_id, email, full_name, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *;`,
      [
        userId,
        data.business_id,
        data.email,
        data.full_name,
        data.role || "member",
        data.status || "active",
      ]
    );
    return res.rows[0];
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.full_name !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(data.full_name);
    }
    if (data.role !== undefined) {
      fields.push(`role = $${idx++}`);
      values.push(data.role);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
    }

    if (fields.length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error(`User ${id} not found`);
      return existing;
    }

    values.push(id);
    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;
    const res = await query<User>(sql, values);
    return res.rows[0];
  }

  async delete(id: string): Promise<boolean> {
    const res = await query("DELETE FROM users WHERE id = $1;", [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
