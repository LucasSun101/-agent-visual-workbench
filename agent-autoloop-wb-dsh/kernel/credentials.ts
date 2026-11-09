// 运行令牌和卡片链接由主密钥推导而来，从不落盘；访问密钥只保存哈希。
// 内核不保存任何密钥原文，凭据作为参数从外部传入，保持确定性与零外连。
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { rows, type View } from "./evolve.ts";

export type Environment = { secret: string; publicUrl: string };

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** 由主密钥派生一段凭据：同样的一段数据永远得到同样的值，但不可反推。 */
export const credential = (env: Environment, purpose: string, ...parts: unknown[]) =>
  createHmac("sha256", env.secret)
    .update(JSON.stringify([purpose, ...parts]))
    .digest("base64url");

/** 谁持有这把密钥：在 keys 表里按哈希查找。查不到返回 null。 */
export function whose(view: View, kind: string, key: string): string | null {
  if (!key) return null;
  const given = Buffer.from(digest(key), "hex");
  const found = rows(view, "keys").find(
    (row) => row.kind === kind && timingSafeEqual(Buffer.from(row.hash, "hex"), given),
  );
  return found?.name ?? null;
}
