import { childAccountText } from './child-account';

describe('childAccountText', () => {
  it('lowers capitals and keeps letters and digits', () => {
    expect(childAccountText('XiaoMing2019')).toBe('xiaoming2019');
  });

  it('leaves out spaces, signs, other letters and Chinese characters', () => {
    expect(childAccountText(' le-le_2019! 乐乐 é')).toBe('lele2019');
  });

  it('takes no more than the 20 characters an account may have', () => {
    expect(childAccountText('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrst');
  });
});
