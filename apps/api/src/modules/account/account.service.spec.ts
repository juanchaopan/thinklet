import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../infrastructure/config/environment.js';
import { StillAdminError } from '../../infrastructure/errors/api-error.js';
import {
  IdentityProviderError,
  type AuthingManagement,
} from '../../infrastructure/identity-provider/authing-management.js';
import type { ChildrenService } from '../child/children.service.js';
import type { ParentDeletionService } from '../family/parent-deletion.service.js';
import { AccountService } from './account.service.js';

const ISSUER = 'https://idp.example.com/oidc';
const PARENT_ID = '0b7c4e2a-1d3f-4a5b-9c6d-7e8f90a1b2c6';

/** The service with its collaborators replaced by doubles that record the order of calls. */
function serviceWith(options: {
  account?: { subject: string; adminFamilies: Array<{ id: string; name: string }> } | undefined;
  authingFails?: Error;
  deletedChildren?: string[];
}) {
  const calls: string[] = [];
  const parents = {
    accountOf: vi.fn(() => {
      calls.push('accountOf');
      return Promise.resolve(
        'account' in options ? options.account : { subject: 'sub-1', adminFamilies: [] },
      );
    }),
    deleteOwnAccount: vi.fn(() => {
      calls.push('deleteOwnAccount');
      return Promise.resolve({ childIds: options.deletedChildren ?? [] });
    }),
    deleteReportedAccount: vi.fn((_issuer: string, subject: string) => {
      calls.push(`deleteReportedAccount ${subject}`);
      return Promise.resolve(
        subject === 'unknown' ? undefined : { childIds: [`child-${subject}`] },
      );
    }),
  };
  const children = {
    removeLoginLinksOf: vi.fn((childIds: readonly string[]) => {
      calls.push(`removeLoginLinksOf ${childIds.join(',')}`);
      return Promise.resolve();
    }),
  };
  const authing = {
    deleteUser: vi.fn((subject: string) => {
      calls.push(`deleteUser ${subject}`);
      return options.authingFails ? Promise.reject(options.authingFails) : Promise.resolve();
    }),
  };
  const service = new AccountService(
    parents as unknown as ParentDeletionService,
    children as unknown as ChildrenService,
    authing as unknown as AuthingManagement,
    { get: () => ISSUER } as unknown as ConfigService<Environment, true>,
  );
  return { service, calls, parents };
}

describe('AccountService', () => {
  describe('deleteOwnAccount', () => {
    it('deletes the account at Authing first, then here, then the links of any children deleted', async () => {
      const { service, calls } = serviceWith({ deletedChildren: ['child-1'] });

      await service.deleteOwnAccount(PARENT_ID);

      expect(calls).toEqual([
        'accountOf',
        'deleteUser sub-1',
        'deleteOwnAccount',
        'removeLoginLinksOf child-1',
      ]);
    });

    it('refuses a family admin with still_admin and the families, deleting nothing anywhere', async () => {
      const adminFamilies = [{ id: 'family-1', name: '林悦的家' }];
      const { service, calls } = serviceWith({ account: { subject: 'sub-1', adminFamilies } });

      const error = await service.deleteOwnAccount(PARENT_ID).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(StillAdminError);
      expect(error).toMatchObject({ code: 'still_admin', families: adminFamilies });
      expect(calls).toEqual(['accountOf']);
    });

    it('answers 502 identity_provider_failed and deletes nothing here when Authing fails', async () => {
      const { service, calls } = serviceWith({
        authingFails: new IdentityProviderError('delete', 'status 500'),
      });

      await expect(service.deleteOwnAccount(PARENT_ID)).rejects.toMatchObject({
        code: 'identity_provider_failed',
        status: 502,
      });
      expect(calls).toEqual(['accountOf', 'deleteUser sub-1']);
    });

    it('lets any other failure of the Authing call through as it is', async () => {
      const unexpected = new Error('unexpected');
      const { service } = serviceWith({ authingFails: unexpected });

      await expect(service.deleteOwnAccount(PARENT_ID)).rejects.toBe(unexpected);
    });

    it('answers a parent who is gone already with 401 unauthenticated', async () => {
      const { service, calls } = serviceWith({ account: undefined });

      await expect(service.deleteOwnAccount(PARENT_ID)).rejects.toMatchObject({
        code: 'unauthenticated',
        status: 401,
      });
      expect(calls).toEqual(['accountOf']);
    });
  });

  describe('deleteReportedUsers', () => {
    it("deletes each reported user by the configured issuer, one after another, with their children's links", async () => {
      const { service, calls, parents } = serviceWith({});

      await service.deleteReportedUsers(['a', 'unknown', 'b']);

      expect(parents.deleteReportedAccount).toHaveBeenCalledWith(ISSUER, 'a');
      expect(calls).toEqual([
        'deleteReportedAccount a',
        'removeLoginLinksOf child-a',
        'deleteReportedAccount unknown',
        'removeLoginLinksOf ',
        'deleteReportedAccount b',
        'removeLoginLinksOf child-b',
      ]);
    });
  });
});
