'use strict';
/**
 * 构建插件入口（Creator 3.8 builder contribution）。
 * 只挂微信小游戏平台：其它平台没有 remote/ 远程包，不需要处理。
 */
exports.configs = {
  wechatgame: {
    hooks: './hooks',
  },
};
