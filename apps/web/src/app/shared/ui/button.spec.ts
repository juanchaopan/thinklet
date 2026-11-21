import { ChangeDetectionStrategy, Component } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { Button, IconButton } from './button';
import { LineIcon } from './line-icon';

@Component({
  imports: [Button, IconButton, LineIcon],
  template: `
    <button type="button" appButton>保存</button>
    <button type="button" appButton="secondary">取消</button>
    <button type="button" appButton="danger">移出</button>
    <button type="button" appButton="text">离开家庭</button>
    <button type="button" appButton [compact]="true">保存一下</button>
    <a appButton="secondary" href="/child">孩子登录</a>
    <button type="button" appIconButton aria-label="改名字"><app-line-icon name="pencil" /></button>
    <button type="button" appButton disabled>处理中</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Buttons {}

const box = (name: string) => screen.getByRole('button', { name }).getBoundingClientRect();

describe('Button', () => {
  beforeEach(async () => {
    await render(Buttons);
  });

  it('is at least 44 px high in every kind, and a pill', () => {
    for (const name of ['保存', '取消', '移出', '离开家庭', '保存一下', '处理中']) {
      expect(box(name).height).toBeGreaterThanOrEqual(44);
    }
    expect(box('保存').height).toBe(48);
    expect(box('保存一下').height).toBe(48);
    const radius = getComputedStyle(screen.getByRole('button', { name: '保存' })).borderRadius;
    expect(Number.parseFloat(radius)).toBeGreaterThan(1000);
  });

  it('colours each kind from the theme', () => {
    const background = (name: string) =>
      getComputedStyle(screen.getByRole('button', { name })).backgroundColor;
    expect(background('保存')).toBe('rgb(29, 34, 56)');
    expect(background('取消')).toBe('rgb(255, 255, 255)');
    expect(background('移出')).toBe('rgb(192, 33, 63)');
  });

  it('makes a link look the same', () => {
    const link = screen.getByRole('link', { name: '孩子登录' });

    expect(link.getBoundingClientRect().height).toBe(48);
  });

  it('gives a symbol-only button 44×44 px and its name', async () => {
    expect(box('改名字').width).toBe(44);
    expect(box('改名字').height).toBe(44);
    await expectNoAxeViolations();
  });
});
