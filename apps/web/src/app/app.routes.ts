import type { Routes } from '@angular/router';
import { matchVisitor, requireFamily, requireNoFamily, requireParent } from './core/guards';
import { AppShell } from './core/layout/app-shell';

/**
 * `/` is the product home for a visitor and the home page for a signed-in
 * parent; `/child`, the child login, needs no login either and shows the same
 * to a signed-in parent. Every other page needs a signed-in parent; a visitor
 * is sent to the product home, and an unknown address goes to `/`. The
 * family pages need a family (a parent without one goes to `/start`), and
 * the start page is only for a parent without one (a parent with one goes
 * to `/`). Route titles become the browser title "<title> - 好奇星球"
 * (core/page-title).
 */
export const routes: Routes = [
  {
    path: 'child',
    title: '孩子登录',
    loadComponent: () => import('./features/child/child-login').then((module) => module.ChildLogin),
  },
  {
    path: '',
    pathMatch: 'full',
    canMatch: [matchVisitor],
    loadComponent: () =>
      import('./features/home/visitor-home').then((module) => module.VisitorHome),
  },
  {
    path: '',
    component: AppShell,
    canActivate: [requireParent],
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [requireFamily],
        loadComponent: () => import('./features/home/home').then((module) => module.Home),
      },
      {
        path: 'start',
        canActivate: [requireNoFamily],
        loadComponent: () => import('./features/start/start').then((module) => module.Start),
      },
      {
        path: 'join',
        title: '加入家庭',
        canActivate: [requireFamily],
        loadComponent: () => import('./features/join/join').then((module) => module.Join),
      },
      {
        path: 'profile',
        title: '个人设置',
        loadComponent: () => import('./features/profile/profile').then((module) => module.Profile),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
