/**
 * M6 存档调度：把「什么时候写盘」与「写什么」分开。
 *
 * 三条口径直接来自策划案 §16（M6 步骤 1、2）：
 *   1. **存档单位 = 一次交换事务** —— 事务**完成后**才调用 `markDirty()`，
 *      所以中途强杀进程时，盘上留着的永远是上一个事务结束时的状态，
 *      §16 要求的「退出时若事务未完成，回滚到本次交换前状态」是**自然结果**，
 *      不需要额外的回滚代码；
 *   2. **动画期间不落盘** —— 用 `canWrite()` 兜一道：防抖到点时先问一句，播放动画则
 *      返回 false，本次写入**推迟**到动画结束（而不是丢掉）；
 *   3. **<1 秒连续交换合并（防抖）** —— `markDirty()` 重置定时器，安静 1 秒后才落盘。
 *
 * 体力变化、结算、主动退出这类**关键点**走 `flush()` 立即落盘，不等防抖 ——
 * 它们都发生在动画之外，且丢一次就可能是「体力白扣/白送」。
 */

import { SAVE_DEBOUNCE_MS, serializeSave,               } from '../core/index.js';
import { readSave, storageKind, writeSave,                  } from './storage.js';

                                     
                                                   
                           
                                            
                          
                     
                      
     
                                  
    
                                                  
                                                   
     
                                   
                                   
                                           
 

export class SaveManager {
          timer                                                  = null;
          errorReported = false;
          writeCount = 0;
          deferCount = 0;
  /**
   * ⚠️ 不要写成 `constructor(private readonly options)`（参数属性）：
   * `web/` 走的是 Node 原生类型擦除（无打包器、无 tsc），而**参数属性需要生成运行时代码**，
   * 擦除模式直接报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。同理禁用的还有 `enum` / `namespace`。
   */
                   options                    ;

  constructor(options                    ) {
    this.options = options;
  }

  /** 读原始字符串（解析交给 `parseSave`，本类不认识存档结构） */
  read()                {
    return readSave();
  }

  get kind()              {
    return storageKind();
  }

  /** 落盘次数 / 因动画被推迟的次数（开发工具条与自检用） */
  get stats()                                       {
    return { writes: this.writeCount, deferred: this.deferCount };
  }

  /**
   * 请求落盘（会合并 1 秒内的连续调用）。
   *
   * 一次交换事务结束后调用 —— 不要在一次交换**开始时**调用，
   * 否则存下来的是事务中间态（棋盘已变、分数未定）。
   */
  markDirty()       {
    this.schedule(this.options.debounceMs ?? SAVE_DEBOUNCE_MS);
  }

  /**
   * 立即落盘（体力变化 / 结算 / 主动退出等关键点）。
   *
   * ⚠️ **不受 `canWrite()` 限制**：这些调用点本身就在事务边界之外（进入关卡时、
   * 体力变化时、结算时），要写的一定是合法存档点。真正需要挡的是「动画播放中
   * 顺手触发的那次写」——那由 `markDirty()` 走 `canWrite()` 判定。
   *
   * 返回 false = 写失败（已回调 `onWriteError`）。
   */
  flush()          {
    this.cancelTimer();
    const now = this.options.now?.() ?? Date.now();
    const data = this.options.snapshot();
    data.savedAt = now;

    let ok = false;
    try {
      const raw = serializeSave(data);
      ok = (this.options.write ?? writeSave)(raw);
    } catch {
      // 序列化本身出错（理论上不会有）也不能把异常抛回业务层
      ok = false;
    }

    if (!ok) {
      if (!this.errorReported) {
        this.errorReported = true;
        this.options.onWriteError?.('存档写入失败（可能是隐私模式或存储配额已满）——本次进度仅在内存，刷新会丢失');
      }
      return false;
    }

    this.errorReported = false;
    this.writeCount += 1;
    return true;
  }

  /** 取消待落盘（玩家主动退出且已明确不要这份断点时用，避免把刚清掉的断点又写回去） */
  cancel()       {
    this.cancelTimer();
  }

  /** 页面卸载：同步尝试落一次，能写多少算多少 */
  dispose()       {
    this.flush();
    this.cancelTimer();
  }

          schedule(ms        )       {
    this.cancelTimer();
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      if (!this.options.canWrite()) {
        // 「动画期间不落盘」：不是放弃，是延到动画之后（见类注释第 2 条）
        this.deferCount += 1;
        this.schedule(this.options.debounceMs ?? SAVE_DEBOUNCE_MS);
        return;
      }
      this.flush();
    }, ms);
  }

          cancelTimer()       {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
