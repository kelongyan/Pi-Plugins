/**
 * git 分支的异步缓存读取。
 *
 * 渲染必须是同步的，所以这里用「同步返回缓存 + 后台刷新」的模式：
 * 首次调用返回 null 并触发后台查询，之后几次渲染就能拿到值。
 *
 * 借鉴 pi-powerline-footer 的 git-status.ts（MIT, nicobailon）的三个要点：
 * - 命令超时后 kill，绝不让子进程拖住
 * - 失败保留旧值（serve-stale），避免计数闪烁
 * - 带上 `GIT_OPTIONAL_LOCKS=0`，不抢用户的 `.git/index.lock`
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

/** 两次后台查询之间的最小间隔。 */
const REFRESH_INTERVAL_MS = 2000;
/** 单次 git 命令的超时时间。 */
const COMMAND_TIMEOUT_MS = 300;

let cachedCwd: string | undefined;
let cachedBranch: string | null = null;
let lastRequestedAt = 0;
let inFlight = false;

/**
 * 同步读取当前分支；缓存过期时在后台启动一次刷新。
 * 返回 null 表示「未知或不是 git 仓库」，调用方应隐藏该段。
 */
export function readGitBranch(cwd: string | undefined): string | null {
  const target = normalizeCwd(cwd);
  if (!target) return null;

  // cwd 变化时作废全部缓存，避免跨仓库串味。
  if (target !== cachedCwd) {
    cachedCwd = target;
    cachedBranch = null;
    lastRequestedAt = 0;
    inFlight = false;
  }

  const now = Date.now();
  if (!inFlight && now - lastRequestedAt >= REFRESH_INTERVAL_MS) {
    lastRequestedAt = now;
    inFlight = true;
    const requestCwd = target;
    void queryBranch(requestCwd)
      .then((branch) => {
        // 期间 cwd 变了就丢弃结果，防止旧请求污染新状态。
        if (cachedCwd === requestCwd) cachedBranch = branch;
      })
      .finally(() => {
        if (cachedCwd === requestCwd) inFlight = false;
      });
  }

  return cachedBranch;
}

/** 重置缓存（测试与 session 切换时使用）。 */
export function resetGitBranchCache(): void {
  cachedCwd = undefined;
  cachedBranch = null;
  lastRequestedAt = 0;
  inFlight = false;
}

function normalizeCwd(cwd: string | undefined): string | undefined {
  if (typeof cwd !== "string" || cwd.trim().length === 0) return undefined;
  try {
    return resolve(cwd);
  } catch {
    return undefined;
  }
}

function queryBranch(cwd: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise(value);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolvePromise(null);
      return;
    }

    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // 进程已退出。
      }
      finish(null);
    }, COMMAND_TIMEOUT_MS);

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    proc.on("error", () => finish(null));
    proc.on("close", (code) => {
      const branch = stdout.trim();
      // detached HEAD 时 symbolic-ref 会失败，这里直接当作未知（不额外追 sha）。
      finish(code === 0 && branch.length > 0 ? branch : null);
    });
  });
}
