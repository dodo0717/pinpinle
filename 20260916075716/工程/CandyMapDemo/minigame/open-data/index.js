// 开放数据域脚本：微信在隔离的子域里运行它，这里才能用 wx.getFriendCloudStorage 读好友数据，
// 画到 sharedCanvas 上（主域只能发 postMessage 指令，读不到好友数据，也看不到这块画布的内容）。
// 纯 ES5，不走 TS 构建，原样放在包里；game.json 的 openDataContext 指向本目录。
// 对应主域 玩法/wxFriend.ts：syncFriendRank 写入 key='pinpin_rank' 的 wxgame.score。
// 移植自糖果小镇 wx-template/open-data/index.js（评估文档 §C），配色对齐排行榜面板。
/* eslint-disable */
'use strict';

var RANK_KEY = 'pinpin_rank';
var sharedCanvas = wx.getSharedCanvas();
var ctx = sharedCanvas.getContext('2d');

function drawRank() {
  wx.getFriendCloudStorage({
    keyList: [RANK_KEY],
    success: function (res) {
      var data = (res.data || []).map(function (u) {
        var score = 0, stars = 0, unlocked = 1;
        try {
          var kv = (u.KVDataList || []).filter(function (k) { return k.key === RANK_KEY; })[0];
          if (kv) {
            var v = JSON.parse(kv.value);
            score = (v.wxgame && v.wxgame.score) || 0;
            stars = v.totalStars || 0;
            unlocked = v.unlocked || 1;
          }
        } catch (e) {}
        return { name: u.nickname || '玩家', avatar: u.avatarUrl, score: score, stars: stars, unlocked: unlocked };
      }).filter(function (u) { return u.score > 0 || u.stars > 0; });
      data.sort(function (a, b) { return b.score - a.score || b.stars - a.stars; });
      render(data);
    },
    fail: function () { render([]); }
  });
}

function render(list) {
  var W = sharedCanvas.width, H = sharedCanvas.height;
  ctx.clearRect(0, 0, W, H);
  if (W <= 0 || H <= 0) return;
  // 对齐排行榜面板：半透明深蓝底 + 白字 + 前三名金名次
  ctx.fillStyle = 'rgba(23,74,138,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#F5C542';
  ctx.font = 'bold ' + Math.round(W * 0.05) + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('好友排行', W * 0.04, H * 0.07);

  if (!list.length) {
    ctx.fillStyle = '#DDEBFF';
    ctx.font = Math.round(W * 0.034) + 'px sans-serif';
    ctx.fillText('还没有好友上榜，分享给好友一起玩吧', W * 0.04, H * 0.2);
    return;
  }
  var rowH = H * 0.082, top = H * 0.13;
  var nameW = W * 0.44;
  for (var i = 0; i < list.length && i < 20; i++) {
    var u = list[i], y = top + i * rowH;
    // 行底：偶数行浅一层，读起来不串行
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(W * 0.02, y, W * 0.96, rowH);
    }
    ctx.fillStyle = i < 3 ? '#FFD75E' : '#EAF3FF';
    ctx.font = 'bold ' + Math.round(W * 0.038) + 'px sans-serif';
    ctx.fillText(String(i + 1), W * 0.04, y + rowH / 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = Math.round(W * 0.034) + 'px sans-serif';
    ctx.fillText(u.name.slice(0, 8), W * 0.1, y + rowH / 2);
    ctx.fillStyle = '#F5C542';
    ctx.textAlign = 'right';
    ctx.fillText(u.score + ' 分 · ' + u.stars + ' 星', W * 0.96, y + rowH / 2);
    ctx.textAlign = 'left';
  }
}

wx.onMessage(function (msg) {
  if (msg && msg.type === 'drawRank') drawRank();
});

// 子域启动时先画一次
drawRank();
