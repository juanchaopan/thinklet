# 0012 界面组件和样式

## 背景

界面是给 3–18 岁的孩子用的，要有趣，还要符合 WCAG 2.1 AA。

## 比较过的方案

- Angular CDK 加 Tailwind CSS：无样式的组件基础，外观自己设计。
- Angular Material：成品组件库，无障碍做得最好，但外观是 Material Design。
- PrimeNG：组件最多，主题可以换，但体积较大，大版本升级的变化也多。

## 决定

用 Angular CDK 加 Tailwind CSS。颜色、间距等只用 Tailwind 主题里定义的值。

## 理由

- Angular CDK 是 Angular 官方的，焦点管理、键盘操作、弹层、拖放都符合无障碍要求。
- Tailwind 让界面可以完全按儿童风格来设计。

## 代价

- 常用组件要自己做。

## 何时重新考虑

- 自己做组件的工作量明显拖慢了功能开发。

Last changed: #1 (2026-11-19)
