/** 《萌宠拼拼乐》核心算法层对外出口（M2） */
export * from './rng';
export * from './pieces';
export * from './grid';
export * from './move';
export * from './matcher';
export * from './pools';
export * from './collapse';
export * from './merge';
export * from './structure';
export * from './init';
export * from './refill';
export * from './forceConstruct';
// ⚠️ 不再写 `export * from './ledger'`：config.ts 已经 `export * from './ledger'`，
// 两条路径导出同一批名字，Cocos 构建（Rollup）报 84 条「Conflicting namespaces … (will be ignored)」，
// 冲突的名字可能被直接丢掉。ledger 的导出统一经由下面的 config 带出来。
export * from './poolGen';
export * from './config';
export * from './engine';
export * from './progress';
export * from './honor';
export * from './save';
