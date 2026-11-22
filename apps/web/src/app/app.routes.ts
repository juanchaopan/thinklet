import type { Routes } from '@angular/router';
import {
  makeFamilyCurrent,
  matchFamily,
  matchVisitor,
  requireFamily,
  requireFamilyAdmin,
  requireNoFamily,
  requireParent,
} from './core/guards';

/**
 * `/` is the product home for a visitor and the home page for a signed-in
 * parent; `/child`, the child login, needs no login either and shows the same
 * to a signed-in parent. Every other page needs a signed-in parent; a visitor
 * is sent to the product home, and an unknown address goes to `/`. The
 * family pages need a family (a parent without one goes to `/start`), and
 * the start page is only for a parent without one (a parent with one goes
 * to `/`). An invitation link `/join/<code>` opens the join dialog over the
 * join page for a parent with a family and over the start page for one
 * without. A family's own pages, `/families/<id>` and its new members page,
 * make that family the current one; the new members page is its admin's.
 * Route titles become the browser title "<title> - 好奇星球"
 * (core/page-title).
 *
 * Every page is loaded when it is first opened, and so is the signed-in
 * frame with its menus: a visitor's first page loads neither.
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
    loadComponent: () => import('./core/layout/app-shell').then((module) => module.AppShell),
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
        title: '开始',
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
        path: 'join/:code',
        title: '加入家庭',
        canMatch: [matchFamily],
        loadComponent: () => import('./features/join/join').then((module) => module.Join),
      },
      {
        path: 'join/:code',
        title: '开始',
        loadComponent: () => import('./features/start/start').then((module) => module.Start),
      },
      {
        path: 'families/:familyId',
        title: '家庭管理',
        canActivate: [makeFamilyCurrent],
        loadComponent: () =>
          import('./features/family/family-page').then((module) => module.FamilyPage),
      },
      {
        path: 'families/:familyId/new-members',
        title: '新成员',
        canActivate: [makeFamilyCurrent, requireFamilyAdmin],
        loadComponent: () =>
          import('./features/new-members/new-members').then((module) => module.NewMembers),
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
