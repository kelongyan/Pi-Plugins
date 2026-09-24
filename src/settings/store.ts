/**
 * 配置持久化：写入 Pi 原生 settings.json 的 `pi-zxdl` 命名空间。
 *
 * 三条安全原则：
 * 1. 原子写：先写临时文件再 rename，避免半写损坏用户配置
 * 2. 读失败不覆盖：settings.json 解析失败时放弃写入，而不是用默认值把它冲掉
 * 3. 只动自己的命名空间：写入前重读文件，保留其它扩展与 Pi 自身的字段
 *
 * 原子写与字段级保留的做法参考 alps-pi `src/settings-store.ts`（MIT, MrCKR）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SETTINGS, cloneSettings, normalizeSettings, type ZxdlSettings } from "./schema.ts";

/** settings.json 中属于本扩展的命名空间键。 */
export const SETTINGS_NAMESPACE = "pi-zxdl";

/** 存储结构版本，便于日后迁移。 */
export const STORAGE_VERSION = 1;

export type WriteResult = { ok: true } | { ok: false; error: string };

/** 解析 Pi 的 agent 目录，与 Pi 自身保持一致。 */
export function resolveAgentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  try {
    return getAgentDir();
  } catch {
    // 旧版本未导出 getAgentDir 时回退到约定路径。
  }
  return join(homedir(), ".pi", "agent");
}

export function resolveSettingsFilePath(): string {
  return join(resolveAgentDir(), "settings.json");
}

/** 读取整个 settings.json。文件不存在按空对象处理；解析失败返回 undefined。 */
function readRootSettings(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** 读取本扩展配置。文件缺失或损坏时回退默认值。 */
export function readPersistedSettings(): ZxdlSettings {
  const root = readRootSettings(resolveSettingsFilePath());
  if (!root) return cloneSettings(DEFAULT_SETTINGS);
  return normalizeSettings(root[SETTINGS_NAMESPACE]);
}

/** 只读出本扩展的原始持久化记录（含 _storageVersion），供迁移判断使用。 */
export function readRawPersistedRecord(): Record<string, unknown> | undefined {
  const root = readRootSettings(resolveSettingsFilePath());
  if (!root) return undefined;
  const record = root[SETTINGS_NAMESPACE];
  return typeof record === "object" && record !== null ? (record as Record<string, unknown>) : undefined;
}

/**
 * 写入本扩展配置。写入前重读文件，只替换自身命名空间。
 */
export function writePersistedSettings(settings: ZxdlSettings): WriteResult {
  const file = resolveSettingsFilePath();
  const root = readRootSettings(file);
  if (!root) {
    return { ok: false, error: `${file} 解析失败，已跳过写入以避免损坏用户配置` };
  }
  root[SETTINGS_NAMESPACE] = { _storageVersion: STORAGE_VERSION, ...cloneSettings(settings) };
  try {
    atomicWriteJson(file, root);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** 原子写：临时文件 + rename。失败时清理临时文件并抛错。 */
export function atomicWriteJson(file: string, value: unknown): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // 临时文件清理失败无需上报。
    }
    throw error;
  }
}
