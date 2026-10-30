/**
 * 首页左上角的头像 + 昵称，以及点它弹出的「我的资料」面板（2026-10-25）。
 *
 *   - AvatarView：圆形头像。三种来源按优先级：微信头像（远程图）→ 预设头像图（src 有值时）→ 预设 emoji 占位。
 *   - ProfilePanel：大头像预览 + 昵称（点「修改」弹系统键盘）+「使用微信头像和昵称」+ 8 个预设头像。
 *     「使用微信…」在微信里是一块透明的原生授权按钮（wx.createUserInfoButton）盖在画出来的按钮上，
 *     面板关掉时必须销毁，否则原生按钮会一直挡在屏幕上。
 *
 * 数据与后端同步全在 玩法/profile.ts；这里只管画和点。
 */

import { Node, Graphics, Label, Color, Sprite, SpriteFrame, Texture2D, resources, Vec3, tween, UIOpacity, EventTouch, loadImage } from 'cc';
import {
  PRESET_AVATARS, getProfile, onProfileChanged, pickPreset, setNickname, inputNickname,
  canUseWxButton, mountWxInfoButton, NICKNAME_MAX, type Profile,
} from '../玩法/profile';
import { hex, fillV, shadow, mkNode, mkGfx, mkText, setSpriteRadii, screenH } from '../玩法/paint';
import { FONT_SANS } from '../玩法/theme';
import { GS } from '../玩法/state';
import { ownedRewards, type AvatarFrameId } from '../核心/index';

const BROWN = hex('#6B4A2F');

/**
 * 头像框（章节宝箱奖励，评审 P0-4）：代码绘制占位，美术出图后换成 Sprite 即可。
 *   star 萌宠新星 = 金色双圈；king 终极拼王 = 紫金双圈 + 顶部皇冠
 */
function avatarFrame(parent: Node, size: number, x: number, y: number, id: AvatarFrameId): void {
  const g = mkGfx(parent, 'AvatarFrame', size + 60, size + 60, x, y);
  const r = size / 2;
  const outer = id === 'king' ? hex('#8E5BD8') : hex('#E8A820');
  g.lineWidth = 12;
  g.strokeColor = outer;
  g.circle(0, 0, r + 12);
  g.stroke();
  g.lineWidth = 4;
  g.strokeColor = GOLD;
  g.circle(0, 0, r + 22);
  g.stroke();
  if (id === 'king') mkText(g.node, '👑', 0, r + 26, 120, { font: FONT_SANS, size: 64, color: new Color(255, 255, 255) });
}

/** 称号胶囊（压在头像下沿） */
function titleBadge(parent: Node, title: string, x: number, y: number): void {
  const w = Math.max(200, title.length * 40 + 60);
  const g = mkGfx(parent, 'TitleBadge', w, 56, x, y);
  g.fillColor = hex('#E8A820');
  g.roundRect(-w / 2, -28, w, 56, 28);
  g.fill();
  mkText(g.node, title, 0, 0, w - 20, { font: FONT_SANS, size: 34, color: new Color(255, 255, 255), bold: true });
}
const GOLD = hex('#F5C542');
const CREAM_A = hex('#FFF8E7');
const CREAM_B = hex('#fdeccb');

/* ================================================================ 头像 */

/** 圆形头像：随资料变化自动重画（销毁节点即退订） */
export class AvatarView {
  readonly node: Node;
  private readonly size: number;
  private bg: Graphics;
  private emoji: Label;
  private pic: Sprite;
  private fixed: number | null;
  private off: (() => void) | null = null;
  private token = 0;

  /** fixedPreset：固定显示某个预设（面板里的候选格用）；null = 跟随玩家资料 */
  constructor(parent: Node, size: number, x = 0, y = 0, fixedPreset: number | null = null, ring = true) {
    this.size = size;
    this.fixed = fixedPreset;
    this.node = mkNode(parent, 'Avatar', size, size, x, y);
    this.bg = this.node.addComponent(Graphics);
    this.emoji = mkText(this.node, '', 0, -size * 0.02, size, { font: FONT_SANS, size: Math.round(size * 0.62), color: new Color(255, 255, 255) });
    const pn = mkNode(this.node, 'Pic', size - 8, size - 8);
    this.pic = pn.addComponent(Sprite);
    this.pic.sizeMode = Sprite.SizeMode.CUSTOM;
    setSpriteRadii(this.pic, [(size - 8) / 2, (size - 8) / 2, (size - 8) / 2, (size - 8) / 2]);
    this.ring = ring;
    if (fixedPreset === null) {
      this.off = onProfileChanged((p) => this.paint(p));
    }
    this.paint(getProfile());
  }

  private ring: boolean;

  destroy(): void {
    this.off?.();
    this.off = null;
    if (this.node.isValid) this.node.destroy();
  }

  private paint(p: Profile): void {
    if (!this.node.isValid) { this.off?.(); return; }
    const idx = this.fixed ?? p.avatar;
    const preset = PRESET_AVATARS[idx] ?? PRESET_AVATARS[0]!;
    const r = this.size / 2;
    const g = this.bg;
    g.clear();
    if (this.ring) {
      shadow(g, new Color(40, 20, 5, 90), 8, 0, 3);
      g.fillColor = new Color(255, 255, 255);
      g.circle(0, 0, r);
      g.fill();
      shadow(g, null);
    }
    g.fillColor = hex(preset.bg);
    g.circle(0, 0, r - 4);
    g.fill();
    this.emoji.string = preset.emoji;
    this.pic.spriteFrame = null;
    const token = ++this.token;
    const wxUrl = this.fixed === null && p.useWx ? p.wxAvatar : '';
    if (wxUrl) {
      // 微信头像：远程图（thirdwx.qlogo.cn），加载期间先显示预设，拿到再盖上
      loadImage(wxUrl).then((img: unknown) => {
        if (token !== this.token || !this.node.isValid) return;
        this.setTexture(new Texture2D(img as never));
      }, () => { /* 拿不到就留着预设头像 */ });
    } else if (preset.src) {
      resources.load(`${preset.src}/texture`, Texture2D, (err: unknown, tex: Texture2D | null) => {
        if (err || !tex || token !== this.token || !this.node.isValid) return;
        this.setTexture(tex);
      });
    }
  }

  private setTexture(tex: Texture2D): void {
    const sf = new SpriteFrame();
    sf.texture = tex;
    this.pic.spriteFrame = sf;
    this.emoji.string = '';
  }
}

/* ================================================================ 资料面板 */

export interface ProfilePanelHost {
  toast: (text: string, ms?: number) => void;
}

export class ProfilePanel {
  private root: Node | null = null;
  private killWxBtn: (() => void) | null = null;
  /** 改名时收起原生授权按钮，改完用它放回来 */
  private remountWx: (() => void) | null = null;
  private offProfile: (() => void) | null = null;

  private readonly parent: Node;
  private readonly host: ProfilePanelHost;

  constructor(parent: Node, host: ProfilePanelHost) {
    this.parent = parent;
    this.host = host;
  }

  get open(): boolean {
    return !!this.root?.isValid;
  }

  show(): void {
    if (this.open) return;
    const H = screenH();
    const root = mkNode(this.parent, 'ProfilePanel', 1080, H);
    this.root = root;
    const op = root.addComponent(UIOpacity);
    const mask = mkGfx(root, 'Mask', 1080, H);
    mask.fillColor = new Color(20, 12, 4, 120);
    mask.rect(-540, -H / 2, 1080, H);
    mask.fill();
    // 吞掉触摸（不然会穿到地图上拖动 / 点到珠子）；点遮罩空白处关闭
    mask.node.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; });
    mask.node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; this.hide(); });

    const W = 900;
    const CH = 1240;
    const card = mkNode(root, 'Card', W, CH, 0, 0);
    // 卡片自己吞触摸：点卡片空白处不关闭
    card.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; });
    card.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });
    const g = card.addComponent(Graphics);
    shadow(g, new Color(60, 40, 10, 115), 64, 0, 26);
    g.roundRect(-W / 2, -CH / 2, W, CH, 38);
    fillV(g, CH / 2, -CH / 2, CREAM_A, CREAM_B);
    shadow(g, null);
    g.lineWidth = 6;
    g.strokeColor = GOLD;
    g.roundRect(-W / 2 + 3, -CH / 2 + 3, W - 6, CH - 6, 35);
    g.stroke();

    const top = CH / 2;
    mkText(card, '我的资料', 0, top - 90, 700, {
      font: FONT_SANS, size: 72, color: BROWN, bold: true, outline: GOLD, outlineWidth: 3,
      shadow: { color: new Color(0, 0, 0, 31), y: 4 },
    });

    // 大头像 + 昵称；章节宝箱奖励（评审 P0-4）：头像框画在头像外圈，称号压在头像下沿
    const rewards = ownedRewards(GS.data.progress.normal);
    const frame = rewards.frames.includes('king') ? 'king' : rewards.frames.includes('star') ? 'star' : null;
    if (frame) avatarFrame(card, 200, 0, top - 280, frame);
    new AvatarView(card, 200, 0, top - 280);
    const title = rewards.titles[rewards.titles.length - 1];
    // y 取 -372：胶囊下沿 -400，不碰下面昵称（中心 -430、字号 52）
    if (title) titleBadge(card, title, 0, top - 372);
    const nick = mkText(card, '', 0, top - 430, 760, { font: FONT_SANS, size: 52, color: BROWN, bold: true });
    const paintNick = (p: Profile): void => { if (nick.isValid) nick.string = p.nickname; };
    paintNick(getProfile());
    this.offProfile = onProfileChanged(paintNick);

    // 修改昵称
    this.button(card, '✎ 修改昵称', 0, top - 530, 420, 104, false, () => void this.editNickname());

    // 使用微信头像和昵称
    const wxY = top - 670;
    const wxW = 720;
    const wxH = 116;
    const wxBtn = this.button(card, '使用微信头像和昵称', 0, wxY, wxW, wxH, true, () => {
      // 浏览器预览 / 基础库不支持：说明一下，引导玩家用下面的预设
      if (!canUseWxButton()) this.host.toast('请在微信里使用；也可以直接选下面的头像', 2200);
    });
    if (canUseWxButton()) {
      // 原生透明按钮盖在画出来的按钮上（位置要等弹入动画结束、用最终坐标算）
      const mount = (): void => {
        if (!this.open) return;
        this.killWxBtn?.();
        this.killWxBtn = mountWxInfoButton({ x: 0, y: wxY, w: wxW, h: wxH }, H, (ok, why) => {
          if (ok) this.host.toast('已使用微信头像和昵称', 1800);
          else if (why === 'anon') this.host.toast('没有拿到微信头像昵称，选一个喜欢的头像、起个名字吧', 2600);
          else this.host.toast('没有授权也没关系，选一个喜欢的头像吧', 2200);
        });
      };
      this.remountWx = mount;
      setTimeout(mount, 400);
    }
    void wxBtn;

    // 预设头像
    mkText(card, '或者选一个萌宠头像', 0, top - 790, 760, { font: FONT_SANS, size: 36, color: hex('#8a6a44'), bold: true });
    const cell = 170;
    const sel: Graphics[] = [];
    const paintSel = (p: Profile): void => {
      sel.forEach((sg, i) => {
        if (!sg.isValid) return;
        sg.clear();
        if (!p.useWx && p.avatar === i) {
          sg.lineWidth = 9;
          sg.strokeColor = hex('#37B84A');
          sg.circle(0, 0, cell / 2 - 10);
          sg.stroke();
        }
      });
    };
    PRESET_AVATARS.forEach((_, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = (col - 1.5) * (cell + 18);
      const y = top - 920 - row * (cell + 18);
      const n = mkNode(card, `Preset${i}`, cell, cell, x, y);
      new AvatarView(n, cell - 34, 0, 0, i);
      sel.push(mkGfx(n, 'Sel', cell, cell));
      n.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; n.setScale(0.92, 0.92); });
      n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1));
      n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
        e.propagationStopped = true;
        n.setScale(1, 1);
        void pickPreset(i).then((err) => { if (err) this.host.toast(err, 2400); });
      });
    });
    paintSel(getProfile());
    const offSel = onProfileChanged(paintSel);
    const prevOff = this.offProfile;
    this.offProfile = () => { prevOff?.(); offSel(); };

    // ✕ 关闭
    const cx = mkNode(card, 'Close', 90, 90, W / 2 - 50, top - 46);
    const cg = cx.addComponent(Graphics);
    cg.fillColor = new Color(0, 0, 0, 64);
    cg.circle(0, -3, 30);
    cg.fill();
    cg.fillColor = hex('#b06a3a');
    cg.circle(0, 0, 30);
    cg.fill();
    mkText(cx, '✕', 0, 1, 60, { font: FONT_SANS, size: 34, color: new Color(255, 255, 255), bold: true });
    cx.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; });
    cx.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; this.hide(); });

    op.opacity = 0;
    tween(op).to(0.18, { opacity: 255 }).start();
    card.setScale(0.85, 0.85);
    tween(card).to(0.2, { scale: new Vec3(1.03, 1.03, 1) }).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
  }

  hide(): void {
    this.killWxBtn?.();
    this.killWxBtn = null;
    this.remountWx = null;
    this.offProfile?.();
    this.offProfile = null;
    if (this.root?.isValid) this.root.destroy();
    this.root = null;
  }

  private async editNickname(): Promise<void> {
    // 原生授权按钮会挡住键盘上方的区域，改名期间先收起
    this.killWxBtn?.();
    this.killWxBtn = null;
    const v = await inputNickname(getProfile().nickname);
    if (v !== null) {
      const err = await setNickname(v);
      if (err) this.host.toast(err, 2400);
      else this.host.toast('昵称已保存', 1600);
    }
    this.remountWx?.();
  }

  /** 吊牌同款按钮：绿=主、灰=次（web .rs-btn） */
  private button(parent: Node, label: string, x: number, y: number, w: number, h: number, primary: boolean, onTap: () => void): Node {
    const n = mkNode(parent, 'Btn', w, h + 10, x, y);
    const g = n.addComponent(Graphics);
    const r = h / 2;
    g.fillColor = primary ? new Color(20, 120, 40, 128) : new Color(0, 0, 0, 56);
    g.roundRect(-w / 2, -h / 2 - 6, w, h, r);
    g.fill();
    g.roundRect(-w / 2, -h / 2, w, h, r);
    if (primary) fillV(g, h / 2, -h / 2, hex('#6BE36B'), hex('#37B84A'));
    else { g.fillColor = hex('#5A5A5A'); g.fill(); }
    g.lineWidth = 3;
    g.strokeColor = primary ? hex('#2f9e42') : hex('#D9A227');
    g.roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, r - 1.5);
    g.stroke();
    mkText(n, label, 0, 0, w, { font: FONT_SANS, size: Math.round(h * 0.36), color: new Color(255, 255, 255), bold: true });
    n.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; n.setScale(0.96, 0.96); });
    n.on(Node.EventType.TOUCH_CANCEL, () => n.setScale(1, 1));
    n.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; n.setScale(1, 1); onTap(); });
    return n;
  }
}

export { NICKNAME_MAX };
