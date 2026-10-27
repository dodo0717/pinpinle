/**
 * 发布开关（2026-10-26，评审 P0-3）：测试口径与正式口径的差异**只允许写在这里**。
 *
 * 提审前把 `RELEASE_PROFILE` 改成 `'prod'`，再按 `docs/上线核对清单.md` 逐项核对
 * （清单里还有几项服务端参数，客户端改不到）。
 *
 * 纯数据模块、不依赖 cc，核心层与单测都能直接 import。
 */

                                             

/** 当前发布口径：开发 / 测试服用 'test'，提审包用 'prod' */
export const RELEASE_PROFILE                 = 'test';

                        
     
                                                    
                                                                    
     
                          
                                              
                           
 

const FLAGS                                       = {
  test: { initialUnlocked: 4, runtimeErrorBar: true },
  prod: { initialUnlocked: 1, runtimeErrorBar: false },
};

export const RELEASE                         = FLAGS[RELEASE_PROFILE];
