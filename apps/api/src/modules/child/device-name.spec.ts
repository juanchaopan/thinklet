import { deviceNameOf, UNKNOWN_DEVICE } from './device-name.js';

const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15';
const IPHONE_EDGE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.2903.68 Mobile/15E148 Safari/605.1.15';
const IPHONE_WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.54(0x18003637) NetType/WIFI Language/zh_CN';
const IPHONE_APP_VIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_PHONE_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANDROID_PHONE_EDGE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.2903.70';
const ANDROID_PHONE_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const ANDROID_PHONE_HUAWEI =
  'Mozilla/5.0 (Linux; Android 12; HarmonyOS; ALN-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.196 HuaweiBrowser/15.0.4.312 Mobile Safari/537.36';
const ANDROID_PHONE_QQ =
  'Mozilla/5.0 (Linux; U; Android 13; zh-cn; V2241A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.86 MQQBrowser/15.3 Mobile Safari/537.36';
const ANDROID_PHONE_UC =
  'Mozilla/5.0 (Linux; U; Android 13; zh-CN; V2241A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/17.1.0.1322 Mobile Safari/537.36';
const ANDROID_PHONE_MIUI =
  'Mozilla/5.0 (Linux; U; Android 14; zh-cn; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.80 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.6.40818';
const ANDROID_PHONE_WECHAT =
  'Mozilla/5.0 (Linux; Android 14; 23127PN0CC Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Mobile Safari/537.36 XWEB/1220133 MMWEBSDK/20240404 MMWEBID/2633 MicroMessenger/8.0.49.2600(0x28003133) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WINDOWS_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const WINDOWS_OPERA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAC_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0';
const LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CHROMEBOOK =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('deviceNameOf', () => {
  it.each<[string, string]>([
    [IPAD_SAFARI, 'iPad · Safari'],
    [IPHONE_SAFARI, 'iPhone · Safari'],
    [IPHONE_CHROME, 'iPhone · Chrome'],
    [IPHONE_FIREFOX, 'iPhone · Firefox'],
    [IPHONE_EDGE, 'iPhone · Edge'],
    [IPHONE_WECHAT, 'iPhone · 微信'],
    [ANDROID_PHONE_CHROME, 'Android 手机 · Chrome'],
    [ANDROID_TABLET_CHROME, 'Android 平板 · Chrome'],
    [ANDROID_PHONE_EDGE, 'Android 手机 · Edge'],
    [ANDROID_PHONE_SAMSUNG, 'Android 手机 · Samsung Internet'],
    [ANDROID_PHONE_HUAWEI, 'Android 手机 · 华为浏览器'],
    [ANDROID_PHONE_QQ, 'Android 手机 · QQ 浏览器'],
    [ANDROID_PHONE_UC, 'Android 手机 · UC 浏览器'],
    [ANDROID_PHONE_MIUI, 'Android 手机 · 小米浏览器'],
    [ANDROID_PHONE_WECHAT, 'Android 手机 · 微信'],
    [WINDOWS_EDGE, 'Windows 电脑 · Edge'],
    [WINDOWS_CHROME, 'Windows 电脑 · Chrome'],
    [WINDOWS_FIREFOX, 'Windows 电脑 · Firefox'],
    [WINDOWS_OPERA, 'Windows 电脑 · Opera'],
    [MAC_SAFARI, 'Mac 电脑 · Safari'],
    [MAC_CHROME, 'Mac 电脑 · Chrome'],
    [MAC_FIREFOX, 'Mac 电脑 · Firefox'],
    [LINUX_FIREFOX, 'Linux 电脑 · Firefox'],
    [LINUX_CHROME, 'Linux 电脑 · Chrome'],
    [CHROMEBOOK, 'Chromebook · Chrome'],
  ])('names %s as %s', (userAgent, name) => {
    expect(deviceNameOf(userAgent)).toBe(name);
  });

  it('names an iPad in desktop mode, which sends the User-Agent of a Mac, a Mac', () => {
    expect(deviceNameOf(MAC_SAFARI)).toBe('Mac 电脑 · Safari');
  });

  it('names the device alone when the browser is not known, such as an app showing the page', () => {
    expect(deviceNameOf(IPHONE_APP_VIEW)).toBe('iPhone');
  });

  it.each<[string, string | undefined]>([
    ['no User-Agent', undefined],
    ['an empty User-Agent', ''],
    ['a command-line client', 'curl/8.9.1'],
    ['a browser on no known device', 'Mozilla/5.0 (Unknown OS) Gecko/20100101 Firefox/132.0'],
  ])(`names a browser with %s ${UNKNOWN_DEVICE}`, (_case, userAgent) => {
    expect(deviceNameOf(userAgent)).toBe(UNKNOWN_DEVICE);
  });

  it('never keeps any part of the User-Agent beyond the fixed names', () => {
    const name = deviceNameOf(`${WINDOWS_CHROME} secret-marker`);

    expect(name).toBe('Windows 电脑 · Chrome');
  });
});
