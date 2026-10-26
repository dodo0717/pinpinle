/**
 * 玩家资料：首页左上角木牌里的头像 + 昵称（2026-10-25）。
 *
 * 做法参考糖果小镇（CandyCrushSaga/universal-map-editor/src/minigame/settings.ts + game.ts）：
 *   - 本机存一份（离线也能显示），登录后 PUT /game/api/player/profile 同步到后端；
 *   - 后端只收**预设头像序号**（"0"~"7"，GameProfileController.AVATAR_COUNT = 8）和昵称，
 *     昵称后端再过一遍词表 + 微信 msgSecCheck，被拒就把提示给玩家、本地回滚。
 *
 * 比糖果小镇多一条：**能拿到微信头像昵称就用微信的**。
 *   - 启动时静默查：玩家以前授权过 scope.userInfo → wx.getUserInfo 直接拿；
 *   - 资料面板里有「使用微信头像和昵称」按钮（wx.createUserInfoButton，原生透明按钮盖在上面）。
 *   - 微信对新接入的小游戏可能只回「微信用户」+ 灰头像（官方收紧规则后的默认值），
 *     这种一律视为「没拿到」，提示玩家自己选预设头像、自己起名。
 * 微信头像是图片 URL，后端存不了 → 服务端仍记预设序号，微信头像只在本机显示。
 */

import { cloudSync } from './cloud.js';

/** 预设头像：美术出图前用 emoji 占位；出图后把 src 填成资源路径（如 'avatar/avatar-1'），面板与木牌自动换图 */
export const PRESET_AVATARS                                                            = [
  { emoji: '🐶', src: '', bg: '#FFD9A8' },
  { emoji: '🐱', src: '', bg: '#FFE38A' },
  { emoji: '🐰', src: '', bg: '#FFD1E0' },
  { emoji: '🐻', src: '', bg: '#E8C9A5' },
  { emoji: '🐼', src: '', bg: '#DDE6F0' },
  { emoji: '🦊', src: '', bg: '#FFC7A1' },
  { emoji: '🐸', src: '', bg: '#C8EBB4' },
  { emoji: '🐷', src: '', bg: '#FFC9CF' },
];

export const NICKNAME_MAX = 12;
export const DEFAULT_NICKNAME = '玩家';
/** 微信收紧规则后给的匿名昵称：拿到它等于没拿到 */
const WX_ANON_NICK = '微信用户';

                          
                   
                                                       
                 
                        
                   
                                 
                 
                                           
                  
 

const KEY = 'pinpin.profile';
                                     
const listeners             = [];

function wxApi()      {
  return (globalThis                ).wx ?? null;
}

function readRaw()                {
  try {
    const wx = wxApi();
    if (wx && typeof wx.getStorageSync === 'function') return wx.getStorageSync(KEY) || null;
    const ls = (globalThis                              ).localStorage;
    return ls ? ls.getItem(KEY) : null;
  } catch {
    return null;
  }
}

function writeRaw(v        )       {
  try {
    const wx = wxApi();
    if (wx && typeof wx.setStorageSync === 'function') { wx.setStorageSync(KEY, v); return; }
    const ls = (globalThis                              ).localStorage;
    if (ls) ls.setItem(KEY, v);
  } catch { /* 存不上就只在本次运行有效 */ }
}

/** 解析存档：坏数据一律回默认值（纯函数，单测用） */
export function parseProfile(raw               )          {
  let o                          = {};
  try {
    const v = JSON.parse(raw || 'null');
    if (v && typeof v === 'object') o = v                           ;
  } catch { /* 坏 JSON */ }
  const av = Number(o.avatar);
  const nick = typeof o.nickname === 'string' ? o.nickname.trim() : '';
  const wxAvatar = typeof o.wxAvatar === 'string' && /^https:\/\//.test(o.wxAvatar) ? o.wxAvatar : '';
  return {
    nickname: nick && !checkNickname(nick) ? nick : DEFAULT_NICKNAME,
    avatar: Number.isInteger(av) && av >= 0 && av < PRESET_AVATARS.length ? av : 0,
    wxAvatar,
    useWx: o.useWx === true && !!wxAvatar,
    edited: o.edited === true,
  };
}

let current          = parseProfile(readRaw());

export function getProfile()          {
  return current;
}

/** 榜单 / 结算里「我」的名字 */
export function profileName()         {
  return current.nickname || DEFAULT_NICKNAME;
}

export function onProfileChanged(cb          )             {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function commit(p         )       {
  current = p;
  writeRaw(JSON.stringify(p));
  for (const cb of listeners.slice()) cb(p);
}

/** 昵称本地检查（长度、空白、控制字符）；违规词交给后端。合法返回 null（与糖果小镇同口径） */
export function checkNickname(raw        )                {
  const s = raw.trim();
  if (!s) return '昵称不能为空';
  if (Array.from(s).length > NICKNAME_MAX) return `昵称最多 ${NICKNAME_MAX} 个字`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(s)) return '昵称里有不能用的字符';
  return null;
}

/** 微信给的资料是否「真的」（匿名昵称 / 没头像 = 没拿到） */
export function isRealWxInfo(info                                                                )          {
  if (!info) return false;
  const nick = typeof info.nickName === 'string' ? info.nickName.trim() : '';
  const url = typeof info.avatarUrl === 'string' ? info.avatarUrl : '';
  return !!nick && nick !== WX_ANON_NICK && /^https:\/\//.test(url);
}

/* ---------------------------------------------------------------- 后端同步 */

/**
 * 推到后端；未登录 / 离线返回 true（本地先生效，下次登录再推）。
 * 后端明确拒绝（昵称违规等）返回提示文字。
 */
async function push(p         )                         {
  const cloud = cloudSync();
  if (!cloud?.loggedIn) return true;
  const r = await cloud.api('PUT', '/game/api/player/profile', {
    nickname: Array.from(p.nickname).slice(0, NICKNAME_MAX).join(''),
    avatar: String(p.avatar),
  });
  if (!r || r.code === 200) return true;   // 网络失败按离线处理
  return typeof r.msg === 'string' && r.msg ? r.msg : '资料保存失败，请稍后再试';
}

/** 登录成功后调一次：本机资料推上去（首次登录 / 离线时改过） */
export function syncProfileAfterLogin()       {
  void push(current);
}

/* ---------------------------------------------------------------- 玩家操作 */

/** 改昵称：本地检查 → 后端检查 → 生效。返回 null = 成功，否则是给玩家看的提示 */
export async function setNickname(raw        )                         {
  const err = checkNickname(raw);
  if (err) return err;
  const next          = { ...current, nickname: raw.trim(), edited: true };
  const r = await push(next);
  if (r !== true) return r;
  commit(next);
  return null;
}

/** 选预设头像（同时切到「显示预设头像」） */
export async function pickPreset(i        )                         {
  if (i < 0 || i >= PRESET_AVATARS.length) return null;
  const next          = { ...current, avatar: i, useWx: false, edited: true };
  commit(next);   // 头像不会被拒（序号后端白名单内），先生效再推
  const r = await push(next);
  return r === true ? null : r;
}

/** 用微信资料（面板按钮 / 启动静默获取）。微信只给了匿名默认值时返回 false */
export function applyWxInfo(info                                                                , byUser         )          {
  if (!isRealWxInfo(info)) return false;
  const nick = Array.from(String(info .nickName).trim()).slice(0, NICKNAME_MAX).join('');
  const next          = {
    ...current,
    nickname: checkNickname(nick) ? current.nickname : nick,
    wxAvatar: String(info .avatarUrl),
    useWx: true,
    // 玩家主动点「用微信的」= 他就想要这个；静默拿到的不算玩家改过
    edited: byUser ? false : current.edited,
  };
  commit(next);
  void push(next);
  return true;
}

/**
 * 启动时静默拿微信资料：只在玩家以前授权过、且没自己改过资料时才用。
 * 不弹任何授权框（没授权过就什么都不做，等玩家在资料面板里点按钮）。
 */
export function trySilentWxProfile()       {
  const wx = wxApi();
  if (!wx || current.edited || typeof wx.getSetting !== 'function' || typeof wx.getUserInfo !== 'function') return;
  try {
    wx.getSetting({
      success: (r                                           ) => {
        if (!r?.authSetting?.['scope.userInfo']) return;
        wx.getUserInfo({
          lang: 'zh_CN',
          success: (res                                                          ) => { applyWxInfo(res?.userInfo, false); },
        });
      },
    });
  } catch { /* 基础库太老 */ }
}

/** 本环境能不能弹「使用微信头像昵称」 */
export function canUseWxButton()          {
  const wx = wxApi();
  return !!wx && typeof wx.createUserInfoButton === 'function';
}

/**
 * 在屏幕上一块区域盖一个透明的原生授权按钮（wx.createUserInfoButton）。
 * rect 为**设计坐标**（原点屏幕中心、y 向上），内部换算成微信逻辑 px。返回销毁函数。
 */
export function mountWxInfoButton(
  rect                                                ,
  screenH        ,
  onResult                                                     ,
)             {
  const wx = wxApi();
  if (!canUseWxButton()) return () => {};
  let btn      = null;
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const k = (info?.windowWidth || 375) / 1080;   // 设计 px → 逻辑 px
    btn = wx.createUserInfoButton({
      type: 'text',
      text: '',
      withCredentials: false,
      lang: 'zh_CN',
      style: {
        left: (rect.x - rect.w / 2 + 540) * k,
        top: (screenH / 2 - (rect.y + rect.h / 2)) * k,
        width: rect.w * k,
        height: rect.h * k,
        backgroundColor: '#00000000',
        borderColor: '#00000000',
        borderWidth: 0,
        borderRadius: 0,
        color: '#00000000',
        textAlign: 'center',
        fontSize: 1,
        lineHeight: rect.h * k,
      },
    });
    btn.onTap((res                                                                           ) => {
      if (!res?.userInfo) { onResult(false, 'deny'); return; }
      onResult(applyWxInfo(res.userInfo, true), isRealWxInfo(res.userInfo) ? 'got' : 'anon');
    });
  } catch {
    btn = null;
  }
  return () => {
    try { btn?.destroy(); } catch { /* 已销毁 */ }
    btn = null;
  };
}

/**
 * 弹系统键盘改昵称（小游戏没有输入框）。浏览器预览用 prompt。
 * 返回输入的文字；取消 / 环境不支持返回 null。
 */
export function inputNickname(value        )                         {
  const wx = wxApi();
  if (wx) {
    if (typeof wx.showKeyboard !== 'function' || typeof wx.onKeyboardConfirm !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const finish = (r                           )       => {
        if (done) return;
        done = true;
        wx.offKeyboardConfirm?.(onConfirm);
        wx.offKeyboardComplete?.(onComplete);
        wx.hideKeyboard?.({});
        resolve(r && typeof r.value === 'string' ? r.value : null);
      };
      // 点键盘「完成」= 确认；点空白收起键盘也按当时的内容确认（不然玩家会以为改名没反应）
      const onConfirm = (r                    )       => finish(r);
      const onComplete = (r                    )       => finish(r);
      wx.onKeyboardConfirm(onConfirm);
      wx.onKeyboardComplete?.(onComplete);
      wx.showKeyboard({
        defaultValue: value,
        maxLength: NICKNAME_MAX,
        multiple: false,
        confirmHold: false,
        confirmType: 'done',
        fail: () => finish(null),
      });
    });
  }
  const p = (globalThis                                                          ).prompt;
  return Promise.resolve(typeof p === 'function' ? p(`设置昵称（最多 ${NICKNAME_MAX} 个字）`, value) : null);
}

/** 测试用：重置内存态 */
export function resetProfileForTest(raw                = null)       {
  current = parseProfile(raw);
  listeners.length = 0;
}
