'use strict';
/**
 * 构建后移走 remote/（2026-11-04）
 *
 * 为什么：`resources` 配成远程包后，微信小游戏构建会在构建目录里生成 remote/（约 27 MB）。
 * 它要放到服务器上，不能留在代码包里 —— 不移走的话开发者工具上传报
 * 「源码包超出最大限制 4MB」。以前每次构建都靠手动移走，这里在构建完成时自动做。
 *
 * 做什么：`build/wechatgame-NNN/remote` → `build/_remote-uploaded/wechatgame-NNN`
 *   - 先直接改名；Windows 上开发者工具 / 编辑器盯着目录时常报 EBUSY / EPERM → 重试几次；
 *   - 还不行就「复制 → 核对文件数与总字节 → 删原目录」；
 *   - 目标已存在（同名目录重建）就加时间后缀，不覆盖旧的。
 *
 * ⚠️ 只在本机搬文件，**不上传服务器**：服务器是共享生产机，资源变了要另外上传（见 README）。
 * ⚠️ `throwError = false`：这一步失败不让整次构建失败，只在构建日志里提示手动处理。
 * ⚠️ 只用 Node 内置 fs / path，不依赖 npm 包（编辑器自带的 Node 版本较老，不用 fs.cpSync）。
 */
const fs = require('fs');
const path = require('path');

const NAME = 'move-remote';
const STORE = '_remote-uploaded';
const RETRIES = 4;
const RETRY_MS = 500;

exports.throwError = false;

function log(...args) { console.log(`[${NAME}]`, ...args); }
function warn(...args) { console.warn(`[${NAME}]`, ...args); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 统计目录：文件数 + 总字节 */
function stat(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files += 1; bytes += fs.statSync(p).size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function removeDir(dir) {
  if (typeof fs.rmSync === 'function') fs.rmSync(dir, { recursive: true, force: true });
  else fs.rmdirSync(dir, { recursive: true });
}

/** 带重试执行（EBUSY / EPERM 多半是别的程序短暂占用，等一下就好） */
async function retry(fn) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    try { return fn(); } catch (e) { last = e; await sleep(RETRY_MS); }
  }
  throw last;
}

function mb(bytes) { return (bytes / 1048576).toFixed(2) + ' MB'; }

/** 远程包清单文件名（开了 MD5 缓存时带指纹，如 config.8da80.json）—— 用来判断资源有没有变 */
function configName(remoteDir) {
  const res = path.join(remoteDir, 'resources');
  if (!fs.existsSync(res)) return '(无 resources)';
  const f = fs.readdirSync(res).find((n) => /^config(\.[0-9a-f]+)?\.json$/.test(n));
  return f || '(未找到 config*.json)';
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 核心逻辑（单独导出，方便脱离编辑器测试） */
async function moveRemote(dest) {
  const remote = path.join(dest, 'remote');
  if (!fs.existsSync(remote)) {
    log('构建目录里没有 remote/，跳过：' + dest);
    return { moved: false, reason: 'no-remote' };
  }
  const store = path.join(path.dirname(dest), STORE);
  fs.mkdirSync(store, { recursive: true });
  let target = path.join(store, path.basename(dest));
  if (fs.existsSync(target)) target += '-' + timestamp();

  const before = stat(remote);
  const config = configName(remote);
  let how = 'rename';
  try {
    await retry(() => fs.renameSync(remote, target));
  } catch (e) {
    // 改名一直被占用 → 复制后核对，再删原目录
    how = 'copy';
    warn(`直接移动失败（${e.code || e.message}），改为复制后删除原目录`);
    copyDir(remote, target);
    const after = stat(target);
    if (after.files !== before.files || after.bytes !== before.bytes) {
      throw new Error(`复制核对不一致：原 ${before.files} 个 / ${before.bytes} 字节，复制后 ${after.files} 个 / ${after.bytes} 字节`);
    }
    try {
      await retry(() => removeDir(remote));
    } catch (e2) {
      warn(`已复制到 ${target}，但原 remote/ 删不掉（${e2.code || e2.message}）。` +
        '请关闭开发者工具里打开的这个项目后手动删除，否则上传会超 4MB');
      return { moved: false, reason: 'remove-failed', target, ...before, config };
    }
  }

  const left = stat(dest);
  log(`remote/ 已移到 ${target}（${how}，${before.files} 个文件，${mb(before.bytes)}，清单 ${config}）`);
  log(`构建目录现在 ${mb(left.bytes)}，可以直接在开发者工具上传。`);
  log('⚠️ 资源若有变化，remote/ 仍需另外上传到服务器（对比清单文件名即可判断）。');
  return { moved: true, how, target, ...before, config, packageBytes: left.bytes };
}

exports.moveRemote = moveRemote;

exports.onAfterBuild = async function (options, result) {
  if (options && options.platform && options.platform !== 'wechatgame') return;
  const dest = (result && result.dest) || '';
  if (!dest) { warn('拿不到构建目录（result.dest 为空），跳过'); return; }
  try {
    await moveRemote(dest);
  } catch (e) {
    warn('移动 remote/ 失败，请手动移走后再上传：' + (e && e.message ? e.message : e));
  }
};
