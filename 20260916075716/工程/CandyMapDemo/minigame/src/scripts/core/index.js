/** 《萌宠拼拼乐》核心算法层对外出口（M2） */
export * from './rng.js';
export * from './pieces.js';
export * from './grid.js';
export * from './move.js';
export * from './matcher.js';
export * from './pools.js';
export * from './collapse.js';
export * from './merge.js';
export * from './structure.js';
export * from './init.js';
export * from './refill.js';
export * from './forceConstruct.js';
// ⚠️ 不再写 `export * from './ledger.js'`：config.ts 已经 `export * from './ledger.js'`，
// 两条路径导出同一批名字，Cocos 构建（Rollup）报 84 条「Conflicting namespaces … (will be ignored)」，
// 冲突的名字可能被直接丢掉。ledger 的导出统一经由下面的 config 带出来。
export * from './poolGen.js';
export * from './config.js';
export * from './engine.js';
export * from './progress.js';
export * from './honor.js';
export * from './rank.js';
export * from './save.js';
