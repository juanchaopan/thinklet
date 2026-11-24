import type { Routes } from '@angular/router';
import {
  leaveLoginWhenChildIn,
  makeFamilyCurrent,
  matchChildOnly,
  matchFamily,
  matchVisitor,
  requireChild,
  requireFamily,
  requireNoFamily,
  requireParent,
} from './core/guards';

/**
 * `/` shows whoever is signed in on this browser: the current family's
 * library for a signed-in parent, the child's home page when only a child
 * is signed in, and the product home for a visitor.
 *
 * The child's pages need no parent and have no parent menus: the child login
 * `/child` (a signed-in child goes on to `/child/home`; a signed-in parent
 * sees it as it is), the QR login `/child/qr/<token>`, shown whoever is
 * signed in, and the child's home page `/child/home`, which needs a
 * signed-in child (without one it is the child login).
 *
 * Every other page needs a signed-in parent; a visitor is sent to `/`, and
 * an unknown address goes to `/`. The family pages need a family (a parent
 * without one goes to `/start`), and the start page is only for a parent
 * without one (a parent with one goes to `/`). The library keeps its
 * filters in the address's query (`/?grade=…&scope=family`); a book's page
 * `/books/<id>` shows the book as the current family sees it. An invitation
 * link `/join/<code>` opens the join dialog over the join page for a parent
 * with a family and over the start page for one without. A family's own
 * pages, `/families/<id>` and its children page, make that family the
 * current one; `/families/<id>/new-members` redirects to the family page,
 * where 等你处理 lists the requests waiting, without a word (rules.md,
 * 导航). Route titles become the browser title "<title> - 好奇星球"
 * (core/page-title); the library and the child's home page carry the
 * product name alone, and a book's page sets the book's title itself once
 * the book is read.
 *
 * Every page is loaded when it is first opened, and so is the signed-in
 * frame with its menus: a visitor's first page loads neither.
 */
export const routes: Routes = [
  {
    path: 'child',
    title: '孩子登录',
    canActivate: [leaveLoginWhenChildIn],
    loadComponent: () => import('./features/child/child-login').then((module) => module.ChildLogin),
  },
  {
    path: 'child/qr/:token',
    title: '扫码登录',
    loadComponent: () =>
      import('./features/child/child-qr-login').then((module) => module.ChildQrLogin),
  },
  {
    path: 'child/home',
    canActivate: [requireChild],
    loadComponent: () => import('./features/child/child-home').then((module) => module.ChildHome),
  },
  {
    path: '',
    pathMatch: 'full',
    canMatch: [matchChildOnly],
    loadComponent: () => import('./features/child/child-home').then((module) => module.ChildHome),
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
        loadComponent: () =>
          import('./features/library/library-page').then((module) => module.LibraryPage),
      },
      {
        path: 'books/:bookId',
        canActivate: [requireFamily],
        loadComponent: () => import('./features/book/book-page').then((module) => module.BookPage),
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
        path: 'families/:familyId/children',
        title: '孩子',
        canActivate: [makeFamilyCurrent],
        loadComponent: () =>
          import('./features/children/children-page').then((module) => module.ChildrenPage),
      },
      { path: 'families/:familyId/new-members', redirectTo: '/families/:familyId' },
      {
        path: 'profile',
        title: '个人设置',
        loadComponent: () => import('./features/profile/profile').then((module) => module.Profile),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
