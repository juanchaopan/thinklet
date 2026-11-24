import { childAccountText } from './child-account';

describe('childAccountText', () => {
  it('lowers capitals and keeps letters and digits', () => {
    expect(childAccountText('XiaoMi2019')).toBe('xiaomi2019');
  });

  it('leaves out spaces, signs, other letters and Chinese characters', () => {
    expect(childAccountText(' a-le_2019! 阿乐 é')).toBe('ale2019');
  });

  it('takes no more than the 20 characters an account may have', () => {
    expect(childAccountText('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrst');
  });
});
