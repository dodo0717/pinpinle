/**
 * 设置整屏（从 web/ui/settings.ts 移植，2026-10-30）
 *
 * 音乐 / 音效 / 教学语音三个开关 + 新手教学回看入口 + 版本号。
 * 结构同图鉴整屏：蓝天 + 棕返回钮 + 标题 + 金框棕木卡。
 *
 * ⚠️ 开关即时生效：onChange 交给调用方（MapBootstrap 直接改 GS.setSound/setBgm/setVoice，
 * 与 web/main.ts 的 onChange → audio.setSound 同口径），界面自己不碰存档。
 * ⚠️ 新手教学入口永久保留：首页按钮会在「困难模式累计通关 ≥10 关」后隐藏，
 * 但玩家可能还想回看（策划案 §14 决策 3）。
 * 素材：开关是程序绘制的滑动钮（Web 版是 toggle-on/off 两张切图），不引入新素材。
 */

import { Node, UITransform, Graphics, Label, Color, Layers } from 'cc';
import { SETTINGS, TUTORIAL, VERSION } from '../玩法/text';
import { mkLabel } from './CollectionScreen';

export interface SettingsPatch {
  sound?: boolean;
  bgm?: boolean;
  voice?: boolean;
}

export interface SettingsHandlers {
  onBack: () => void;
  onChange: (patch: SettingsPatch) => void;
  onTutorial: () => void;
}

const CARD_W = 880;
const CARD_H = 720;
const CARD_Y = 60;
const ROW_H = 130;
const SW_W = 150;
const SW_H = 78;

interface ToggleRow {
  sync: (on: boolean) => void;
}

export class SettingsScreen {
  private root: Node = null!;
  private rows: ToggleRow[] = [];
  private h: SettingsHandlers;
  private cur = { sound: true, bgm: true, voice: true };

  private constructor(handlers: SettingsHandlers) {
    this.h = handlers;
  }

  static create(parent: Node, handlers: SettingsHandlers): SettingsScreen {
    const s = new SettingsScreen(handlers);
    s.build(parent);
    return s;
  }

  private build(parent: Node): void {
    const root = new Node('SettingsScreen');
    root.layer = Layers.Enum.UI_2D;
    root.addComponent(UITransform).setContentSize(1080, 1920);
    root.parent = parent;
    root.setPosition(0, 0, 0);
    root.active = false;
    this.root = root;

    const bg = new Node('bg');
    bg.layer = Layers.Enum.UI_2D;
    bg.addComponent(UITransform).setContentSize(1080, 1920);
    const g = bg.addComponent(Graphics);
    g.rect(-540, -960, 1080, 1920);
    g.fillColor = new Color(155, 215, 242, 255);
    g.fill();
    bg.parent = root;

    const back = new Node('back');
    back.layer = Layers.Enum.UI_2D;
    back.addComponent(UITransform).setContentSize(96, 96);
    back.setPosition(-450, 850, 0);
    const bgc = back.addComponent(Graphics);
    bgc.circle(0, 0, 48);
    bgc.fillColor = new Color(150, 106, 62, 255);
    bgc.fill();
    back.parent = root;
    mkLabel(back, '‹', 64, 0, 4, new Color(255, 255, 255), 96);
    back.on(Node.EventType.TOUCH_END, () => this.h.onBack());
    mkLabel(root, SETTINGS.title, 56, 0, 850, new Color(90, 50, 25), 400);

    const card = new Node('card');
    card.layer = Layers.Enum.UI_2D;
    card.addComponent(UITransform).setContentSize(CARD_W, CARD_H);
    card.setPosition(0, CARD_Y, 0);
    const cg = card.addComponent(Graphics);
    cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 30);
    cg.fillColor = new Color(158, 112, 66, 255);
    cg.fill();
    cg.lineWidth = 10;
    cg.strokeColor = new Color(240, 196, 110, 255);
    cg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 30);
    cg.stroke();
    card.parent = root;

    let y = CARD_H / 2 - ROW_H / 2 - 40;
    this.rows.push(this.mkToggle(card, SETTINGS.bgm, y, () => this.h.onChange({ bgm: !this.cur.bgm })));
    y -= ROW_H;
    this.rows.push(this.mkToggle(card, SETTINGS.sound, y, () => this.h.onChange({ sound: !this.cur.sound })));
    y -= ROW_H;
    this.rows.push(this.mkToggle(card, SETTINGS.voice, y, () => this.h.onChange({ voice: !this.cur.voice })));
    y -= ROW_H;

    // 新手教学「查看」—— 永久保留的回看入口
    const tutRow = new Node('row-tutorial');
    tutRow.layer = Layers.Enum.UI_2D;
    tutRow.addComponent(UITransform).setContentSize(CARD_W - 80, ROW_H - 20);
    tutRow.setPosition(0, y, 0);
    tutRow.parent = card;
    mkLabel(tutRow, TUTORIAL.drawerTitle, 38, -CARD_W / 2 + 220, 0, new Color(255, 245, 225), 560);
    this.mkSmallBtn(tutRow, '查看', CARD_W / 2 - 190, () => this.h.onTutorial());

    mkLabel(root, SETTINGS.version(VERSION), 30, 0, CARD_Y - CARD_H / 2 - 60, new Color(80, 60, 40), 600);
  }

  /** 开关行：标签 + 滑动钮（on=绿 / off=灰，圆钮左右滑） */
  private mkToggle(parent: Node, label: string, y: number, onFlip: () => void): ToggleRow {
    const row = new Node('row');
    row.layer = Layers.Enum.UI_2D;
    row.addComponent(UITransform).setContentSize(CARD_W - 80, ROW_H - 20);
    row.setPosition(0, y, 0);
    row.parent = parent;
    mkLabel(row, label, 40, -CARD_W / 2 + 200, 0, new Color(255, 245, 225), 520);

    const slot = new Node('toggle');
    slot.layer = Layers.Enum.UI_2D;
    slot.addComponent(UITransform).setContentSize(SW_W, SW_H);
    slot.setPosition(CARD_W / 2 - 190, 0, 0);
    slot.addComponent(Graphics);
    slot.parent = row;

    const knob = new Node('knob');
    knob.layer = Layers.Enum.UI_2D;
    knob.addComponent(UITransform).setContentSize(SW_H - 12, SW_H - 12);
    const kg = knob.addComponent(Graphics);
    kg.circle(0, 0, (SW_H - 12) / 2);
    kg.fillColor = new Color(255, 255, 255, 255);
    kg.fill();
    knob.parent = slot;
    slot.on(Node.EventType.TOUCH_END, () => onFlip());

    const sync = (on: boolean): void => {
      const sg = slot.getComponent(Graphics)!;
      sg.clear();
      sg.roundRect(-SW_W / 2, -SW_H / 2, SW_W, SW_H, SW_H / 2);
      sg.fillColor = on ? new Color(126, 200, 120, 255) : new Color(120, 120, 128, 255);
      sg.fill();
      knob.setPosition(on ? SW_W / 2 - SW_H / 2 : -(SW_W / 2 - SW_H / 2), 0, 0);
    };
    return { sync };
  }

  private mkSmallBtn(parent: Node, text: string, x: number, onTap: () => void): void {
    const btn = new Node('btn');
    btn.layer = Layers.Enum.UI_2D;
    btn.addComponent(UITransform).setContentSize(220, 92);
    btn.setPosition(x, 0, 0);
    const g = btn.addComponent(Graphics);
    g.roundRect(-110, -46, 220, 92, 46);
    g.fillColor = new Color(255, 196, 92, 255);
    g.fill();
    btn.parent = parent;
    mkLabel(btn, text, 38, 0, 0, new Color(90, 50, 25), 220);
    btn.on(Node.EventType.TOUCH_END, () => onTap());
  }

  /** 同步三个开关（每次打开设置页时调一次） */
  render(settings: { sound: boolean; bgm: boolean; voice: boolean }): void {
    this.cur = { ...settings };
    this.rows[0]!.sync(settings.bgm);
    this.rows[1]!.sync(settings.sound);
    this.rows[2]!.sync(settings.voice);
  }

  show(): void { this.root.active = true; }
  hide(): void { this.root.active = false; }
  rootNode(): Node { return this.root; }
  destroy(): void { if (this.root?.isValid) this.root.destroy(); }
}
