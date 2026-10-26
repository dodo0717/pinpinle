/**
 * 玩家资料（玩法/profile.ts）的纯逻辑：存档解析、昵称检查、微信资料真假判断、操作后的状态。
 * 后端同步走 cloudSync()，测试环境没有 wx → 未登录 → 视为离线成功，只验本地状态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProfile, checkNickname, isRealWxInfo, applyWxInfo, setNickname, pickPreset,
  getProfile, profileName, onProfileChanged, resetProfileForTest,
  PRESET_AVATARS, NICKNAME_MAX, DEFAULT_NICKNAME,
} from '../assets/scripts/玩法/profile';

test('parseProfile：空 / 坏数据回默认，非法字段逐个兜底', () => {
  assert.deepEqual(parseProfile(null), { nickname: DEFAULT_NICKNAME, avatar: 0, wxAvatar: '', useWx: false, edited: false });
  assert.equal(parseProfile('{bad').nickname, DEFAULT_NICKNAME);
  const p = parseProfile(JSON.stringify({ nickname: '  小明  ', avatar: 99, wxAvatar: 'http://x', useWx: true }));
  assert.equal(p.nickname, '小明');
  assert.equal(p.avatar, 0, '越界头像序号回 0');
  assert.equal(p.wxAvatar, '', '非 https 头像不收');
  assert.equal(p.useWx, false, '没有可用微信头像就不能显示微信头像');
  assert.equal(parseProfile(JSON.stringify({ avatar: PRESET_AVATARS.length - 1 })).avatar, PRESET_AVATARS.length - 1);
});

test('checkNickname：空、超长、控制字符拦下；数字标点 emoji 放行', () => {
  assert.ok(checkNickname('   '));
  assert.ok(checkNickname('一'.repeat(NICKNAME_MAX + 1)));
  assert.equal(checkNickname('一'.repeat(NICKNAME_MAX)), null);
  assert.ok(checkNickname('ab'));
  assert.ok(checkNickname('<script>'));
  assert.equal(checkNickname('拼图王 No.1!'), null);
  assert.equal(checkNickname('🐶小狗'), null, 'emoji 按字算，不按 UTF-16 码元');
});

test('isRealWxInfo：匿名「微信用户」/ 没头像 = 没拿到', () => {
  assert.equal(isRealWxInfo(null), false);
  assert.equal(isRealWxInfo({ nickName: '微信用户', avatarUrl: 'https://thirdwx.qlogo.cn/a' }), false);
  assert.equal(isRealWxInfo({ nickName: '小红', avatarUrl: '' }), false);
  assert.equal(isRealWxInfo({ nickName: '小红', avatarUrl: 'https://thirdwx.qlogo.cn/a' }), true);
});

test('操作流：微信资料 → 自选预设 → 改名，状态与通知都对', async () => {
  resetProfileForTest();
  const seen: string[] = [];
  onProfileChanged((p) => seen.push(`${p.nickname}/${p.useWx ? 'wx' : p.avatar}`));

  assert.equal(applyWxInfo({ nickName: '微信用户', avatarUrl: 'https://a' }, true), false, '匿名资料不生效');
  assert.equal(getProfile().useWx, false);

  assert.equal(applyWxInfo({ nickName: '小红', avatarUrl: 'https://thirdwx.qlogo.cn/a' }, true), true);
  assert.equal(getProfile().useWx, true);
  assert.equal(profileName(), '小红');

  assert.equal(await pickPreset(3), null);
  assert.equal(getProfile().useWx, false, '选了预设就切回预设头像');
  assert.equal(getProfile().avatar, 3);
  assert.equal(getProfile().edited, true);

  assert.ok(await setNickname(''), '空昵称被拦');
  assert.equal(profileName(), '小红', '被拦时不改');
  assert.equal(await setNickname(' 拼图王 '), null);
  assert.equal(profileName(), '拼图王');

  // 玩家改过之后，静默拿到的微信资料不应再把 edited 清掉
  applyWxInfo({ nickName: '小红', avatarUrl: 'https://thirdwx.qlogo.cn/a' }, false);
  assert.equal(getProfile().edited, true);

  assert.deepEqual(seen, ['小红/wx', '小红/3', '拼图王/3', '小红/wx']);
});
