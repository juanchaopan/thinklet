/** The name of a remembered browser whose device the User-Agent does not tell. */
export const UNKNOWN_DEVICE = '未知设备';

/** A pattern of the User-Agent and the name it gives. */
type Rule = readonly [pattern: RegExp, name: string];

/**
 * The kinds of device, the first match winning. iPhones and iPads say
 * "like Mac OS X" and Android says "Linux", so they come before the Mac
 * and Linux. An Android phone's browser says "Mobile" and a tablet's does
 * not. An iPad in desktop mode (Safari's default on iPadOS) sends the very
 * User-Agent of a Mac; only touch support, which the server never sees,
 * tells the two apart, so it is named a Mac.
 */
const DEVICES: readonly Rule[] = [
  [/\biPad\b/, 'iPad'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPod\b/, 'iPod'],
  [/\bAndroid\b.*\bMobile\b/, 'Android 手机'],
  [/\bAndroid\b/, 'Android 平板'],
  [/\bWindows NT\b/, 'Windows 电脑'],
  [/\bMacintosh\b/, 'Mac 电脑'],
  [/\bCrOS\b/, 'Chromebook'],
  [/\bLinux\b/, 'Linux 电脑'],
];

/**
 * The browsers, the first match winning. Browsers built on Chrome or
 * WebKit carry their tokens too, so the specific ones come first, Chrome
 * after them and Safari last; Safari is only the one that gives its
 * "Version/", which apps showing pages in their own views do not.
 */
const BROWSERS: readonly Rule[] = [
  [/\bMicroMessenger\//, '微信'],
  [/\bMQQBrowser\/|\bQQBrowser\//, 'QQ 浏览器'],
  [/\bUCBrowser\//, 'UC 浏览器'],
  [/\bHuaweiBrowser\//, '华为浏览器'],
  [/\bMiuiBrowser\//, '小米浏览器'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOPiOS\//, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\/|\bChromium\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const firstMatch = (rules: readonly Rule[], userAgent: string) =>
  rules.find(([pattern]) => pattern.test(userAgent))?.[1];

/**
 * The name a remembered browser is listed with (`.docs/design/rules.md`,
 * "记住的设备"): the device and the browser, such as "iPad · Safari", or
 * the device alone when the browser is not known. A User-Agent that tells
 * no device, or none at all, is "未知设备". Only this name is kept, never
 * the User-Agent itself.
 */
export function deviceNameOf(userAgent: string | undefined): string {
  if (userAgent === undefined) {
    return UNKNOWN_DEVICE;
  }
  const device = firstMatch(DEVICES, userAgent);
  if (device === undefined) {
    return UNKNOWN_DEVICE;
  }
  const browser = firstMatch(BROWSERS, userAgent);
  return browser === undefined ? device : `${device} · ${browser}`;
}
