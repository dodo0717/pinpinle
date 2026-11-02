import { Font, Label, resources } from 'cc';

/**
 * 全项目 UI 文字统一走 HarmonyOS Sans SC（华为官方免费商用许可，见项目永久指令）。
 *
 * ⚠️ 教学模块（tutorial / handHint / spotlight / GameDialog / guide / BoardView）此前
 *    **完全没有设字体**，一直用 Cocos 的默认字体 —— 字形、字重、中文字面都与 Web
 *    （`-apple-system / PingFang SC / Microsoft YaHei`）不是一套，是"UI 细节与 Web 差很远"
 *    的最大单项来源。现在统一从这里取。
 *
 * 两份字重：Web 教学面板的字重集中在 600~900（标题 900、正文 600/700），
 *    所以 UI 文字默认用 **Bold**；只有常规说明性文字才用 Medium。
 */
let bold: Font | null = null;
let medium: Font | null = null;
let loading = false;
const pending: Array<(f: Font | null) => void> = [];

function load(key: 'font/HarmonyOS_Sans_SC_Bold' | 'font/HarmonyOS_Sans_SC_Medium'): Promise<Font | null> {
  return new Promise((resolve) => {
    resources.load(key, Font, (err, f) => resolve(err || !f ? null : f));
  });
}

/** 预加载两份字体（首页起来时调一次，避免首次弹面板时才去读盘、字突然跳一下） */
export async function preloadUiFont(): Promise<void> {
  if (loading || (bold && medium)) return;
  loading = true;
  const [b, m] = await Promise.all([load('font/HarmonyOS_Sans_SC_Bold'), load('font/HarmonyOS_Sans_SC_Medium')]);
  bold = b;
  medium = m;
  loading = false;
  while (pending.length) pending.shift()!(b);
}

/**
 * ⚠️⚠️ 带 emoji 的文本**绝对不能**套 ttf：HarmonyOS Sans SC 是纯中文字体、不含 emoji 字形，
 *    套上之后 emoji 会渲染成空白/豆腐块 —— 教学里到处是 emoji
 *    （状态行 ✅○、补充 🕒⭐🔒、图解 ✨、手指 👆、关闭 ✕、箭头 ➜↑▾ 等）。
 *    Web 那边 emoji 也是由系统 emoji 字体渲染的，所以这里让它们继续走系统默认字体。
 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}]/u;

/**
 * 给一个 Label 套上 UI 字体。字体还没加载完时先挂回调，加载完回填
 * （加载失败就保持系统默认字体，不阻塞、不报错）。
 */
export function applyUiFont(l: Label, weight: 'bold' | 'medium' = 'bold'): void {
  if (EMOJI_RE.test(l.string || '')) return;
  const f = weight === 'bold' ? bold : medium;
  if (f) {
    l.font = f;
    return;
  }
  pending.push((got) => {
    if (got && l.isValid) l.font = weight === 'bold' ? got : got;
  });
  if (!loading) void preloadUiFont();
}

/**
 * 设置文本 + 按需套字体的合体入口：文本里**有 emoji 时把字体还原成系统默认**
 * （`font = null` → 回到 `fontFamily` 系统字体，emoji 才有字形）。
 *
 * 为什么需要它：`applyUiFont` 只在调用那一刻看文本 —— 先套了字体、后把 string 换成
 * 带 emoji 的（如 PLAY 难度钮「简单」→「🔒 困难」），emoji 就会变成豆腐块。
 */
export function applyUiText(l: Label, text: string, weight: 'bold' | 'medium' = 'bold'): void {
  l.string = text;
  if (EMOJI_RE.test(text)) {
    l.font = null;
    return;
  }
  applyUiFont(l, weight);
}
