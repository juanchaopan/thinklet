import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import type { ErrorCode, FamilyCodeLookupResponse } from '@thinklet/contracts';
import { Art } from '../shared/ui/art';
import { Avatar } from '../shared/ui/avatar';
import { Button } from '../shared/ui/button';
import { CodeBoxes, codeSlots, filledCode } from '../shared/ui/code-boxes';
import { Dialog } from '../shared/ui/dialog';
import { Toaster } from '../shared/ui/toast';
import { ApiError } from './api';
import { isSignedOut, showSomethingWentWrong } from './failures';
import { JoinRequests } from './join-requests';

/** What the boxes say when a code cannot be used (rules.md, 输入家庭码). */
const CODE_HINTS: Partial<Record<ErrorCode, string>> = {
  code_not_found: '没有这个家庭码',
  already_member: '你已经是这个家庭的成员',
  request_pending: '你已经申请过了，等管理员处理',
};

/** A family found by its code, kept with the code that found it. */
interface FoundFamily extends FamilyCodeLookupResponse {
  readonly code: string;
}

/**
 * The dialog that asks to join a family (rules.md, 输入家庭码). The code goes
 * into six boxes; as soon as the last one is filled the code is looked up,
 * with no button to press. A code that is not there, a family the parent is
 * already in or has already asked to join is said under the boxes. A family
 * found shows its name and its admin, and the parent sends the request from
 * there or goes back with 换一个家庭码. A sent request closes the dialog with
 * 申请已发出.
 *
 * The admin's avatar takes its colour from the admin's parent id, which the
 * lookup answers with, as every avatar does.
 *
 * `code` fills the boxes as the dialog opens, as an invitation link does;
 * a whole code is looked up at once. `leaveTo` is the address to go to once
 * the dialog closes, which takes an invitation link out of the address bar.
 *
 * Each action button sits alone in its own `@if`: the dialog projects only
 * a block's single root node into its action slot.
 */
@Component({
  selector: 'app-join-family-dialog',
  imports: [Art, Avatar, Button, CodeBoxes, Dialog],
  template: `
    <app-dialog
      [open]="open()"
      [title]="found() ? '申请加入这个家庭？' : '申请加入家庭'"
      [icon]="found() ? undefined : 'letter'"
      size="large"
      (dismissed)="close()"
    >
      @if (found(); as family) {
        <div
          #familyBox
          tabindex="-1"
          class="mt-5 flex items-center gap-4 rounded-2xl bg-tint p-4 outline-none"
        >
          <img alt="" appArt="family" class="size-12" />
          <div class="min-w-0">
            <p class="text-lg font-black">{{ family.familyName }}</p>
            <p class="mt-1 flex items-center gap-2 text-sm text-ink-soft">
              <app-avatar [name]="family.adminName" [parentId]="family.adminId" size="tiny" />
              管理员 {{ family.adminName }}
            </p>
          </div>
        </div>
      } @else {
        <app-code-boxes
          class="mt-6"
          [characters]="characters()"
          (charactersChange)="edited($event)"
          [error]="error()"
          [attempt]="attempt()"
          (completed)="lookUp($event)"
        />
      }
      @if (found()) {
        <button type="button" appButton="secondary" appDialogAction (click)="changeCode()">
          换一个家庭码
        </button>
      }
      @if (found()) {
        <button type="button" appButton appDialogAction [disabled]="sending()" (click)="send()">
          {{ sending() ? '发送中…' : '发送申请' }}
        </button>
      }
      @if (!found()) {
        <button type="button" appButton="secondary" appDialogAction (click)="close()">取消</button>
      }
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinFamilyDialog {
  readonly open = input.required<boolean>();
  /** A code to fill the boxes with, such as the one in an invitation link. */
  readonly code = input<string>();
  /** Where to go once the dialog has closed; it stays on the page without one. */
  readonly leaveTo = input<string>();

  readonly closed = output();

  private readonly requests = inject(JoinRequests);
  private readonly toaster = inject(Toaster);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly characters = signal<readonly string[]>(codeSlots());
  protected readonly found = signal<FoundFamily | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly attempt = signal(0);
  protected readonly sending = signal(false);

  private readonly typedCode = computed(() => filledCode(this.characters()));
  private readonly familyBox = viewChild<ElementRef<HTMLElement>>('familyBox');

  /**
   * Whether the dialog is open, from the moment it opens until it closes
   * itself, its page closes it or the page goes away. The `open` input alone
   * can still read true once the dialog has asked to close, when its page
   * goes away before taking the input back.
   */
  private asking = false;

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.start());
      } else {
        this.asking = false;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.asking = false;
    });
  }

  protected edited(characters: readonly string[]): void {
    this.characters.set(characters);
    this.error.set(null);
  }

  /**
   * Looks the code up; the answer, found or failed, counts only while the
   * dialog is open and the boxes still hold that code. The family found
   * takes the focus from the boxes, which are gone, so screen readers read
   * it and Escape still closes the dialog.
   */
  protected async lookUp(code: string): Promise<void> {
    this.error.set(null);
    try {
      const family = await this.requests.lookUp(code);
      if (this.stillAsking(code)) {
        this.found.set({ ...family, code });
        afterNextRender(() => this.familyBox()?.nativeElement.focus(), {
          injector: this.injector,
        });
      }
    } catch (error) {
      if (this.stillAsking(code)) {
        this.showFailure(error);
      }
    }
  }

  protected changeCode(): void {
    this.found.set(null);
    this.characters.set(codeSlots());
    this.error.set(null);
  }

  protected async send(): Promise<void> {
    const family = this.found();
    if (!family || this.sending()) {
      return;
    }
    this.sending.set(true);
    try {
      await this.requests.send(family.code);
      this.toaster.show('申请已发出', 'success', 'party');
      this.close();
    } catch (error) {
      this.showFailure(error);
    } finally {
      this.sending.set(false);
    }
  }

  protected close(): void {
    this.asking = false;
    this.closed.emit();
    const leaveTo = this.leaveTo();
    if (leaveTo) {
      void this.router.navigateByUrl(leaveTo);
    }
  }

  /** Whether the dialog is still open on the code, so an answer about it is still wanted. */
  private stillAsking(code: string): boolean {
    return this.asking && this.open() && this.typedCode() === code;
  }

  /** Starts over from the given code: a whole one is looked up at once. */
  private start(): void {
    this.asking = true;
    this.found.set(null);
    this.error.set(null);
    this.attempt.set(0);
    this.sending.set(false);
    this.characters.set(codeSlots(this.code()));
    const code = this.typedCode();
    if (code) {
      void this.lookUp(code);
    }
  }

  /**
   * A code that cannot be used goes back to the boxes, which say why and
   * shake; anything else (the server failing or not answering) is a toast,
   * and what was typed stays.
   */
  private showFailure(error: unknown): void {
    if (isSignedOut(error)) {
      return;
    }
    const hint =
      error instanceof ApiError && error.code !== 'network' ? CODE_HINTS[error.code] : undefined;
    if (!hint) {
      showSomethingWentWrong(this.toaster);
      return;
    }
    this.found.set(null);
    this.error.set(hint);
    this.attempt.update((count) => count + 1);
  }
}
