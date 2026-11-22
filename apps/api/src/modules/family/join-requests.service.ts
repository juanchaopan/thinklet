import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ApplicantJoinRequest,
  FamilyCodeLookupResponse,
  FamilyJoinRequestsResponse,
  HandledJoinRequest,
  JoinRequestStatus,
  PendingJoinRequest,
} from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { lockFor } from './families.service.js';
import {
  JoinRequestsRepository,
  RequestPendingError,
  type ApplicantRequestRecord,
  type FamilyRequestRecord,
  type JoinRequestStore,
  type RequestState,
} from './join-requests.repository.js';

/** No family has the code. */
export const codeNotFound = () => new ApiError('code_not_found', HttpStatus.NOT_FOUND);

/** A request that does not exist, or is not the parent's to see, is answered the same. */
export const requestNotFound = () => new ApiError('not_found', HttpStatus.NOT_FOUND);

const alreadyMember = () => new ApiError('already_member', HttpStatus.CONFLICT);
const requestPending = () => new ApiError('request_pending', HttpStatus.CONFLICT);
const requestClosed = () => new ApiError('request_closed', HttpStatus.CONFLICT);

/** What decides whether a parent may apply to a family. */
export interface Application {
  member: boolean;
  pending: boolean;
}

/**
 * Checks that a parent may apply to a family (`.docs/design/rules.md`, "加入
 * 申请"): a member cannot apply, and a parent has at most one pending request
 * to a family at a time.
 */
export function requireApplicable({ member, pending }: Application): void {
  if (member) {
    throw alreadyMember();
  }
  if (pending) {
    throw requestPending();
  }
}

/** Reads the parent's membership and pending request with the store's queries and checks that they may apply. */
async function checkApplicable(
  store: JoinRequestStore,
  familyId: string,
  parentId: string,
): Promise<void> {
  const [role, pending] = await Promise.all([
    store.memberRole(familyId, parentId),
    store.hasPendingRequest(familyId, parentId),
  ]);
  requireApplicable({ member: role !== undefined, pending });
}

/** The request when it is the parent's own; anyone else's is answered as no request at all. */
function ownRequest(request: RequestState | undefined, parentId: string): RequestState {
  if (request?.parentId !== parentId) {
    throw requestNotFound();
  }
  return request;
}

/** The request when it is one of the family's; another family's is answered as no request at all. */
function familyRequest(request: RequestState | undefined, familyId: string): RequestState {
  if (request?.familyId !== familyId) {
    throw requestNotFound();
  }
  return request;
}

/** A request that is no longer pending cannot be withdrawn, approved or rejected. */
function stillPending(request: RequestState): RequestState {
  if (request.status !== 'pending') {
    throw requestClosed();
  }
  return request;
}

/** The applicant withdraws their own request, which must still be pending. */
export function requireWithdrawal(request: RequestState | undefined, parentId: string): void {
  stillPending(ownRequest(request, parentId));
}

/** The admin approves or rejects a request of the family, which must still be pending; returns it. */
export function requireDecision(request: RequestState | undefined, familyId: string): RequestState {
  return stillPending(familyRequest(request, familyId));
}

/**
 * One side's 「知道了」 on a request it sees as closed. A pending request is
 * still waiting; a withdrawn request is never shown to either side, so it is
 * answered as no request at all.
 */
function requireDismissal(request: RequestState): void {
  if (request.status === 'pending') {
    throw requestPending();
  }
  if (request.status === 'withdrawn') {
    throw requestNotFound();
  }
}

/** The applicant's 「知道了」: on their own approved, rejected and expired requests. */
export function requireApplicantDismissal(
  request: RequestState | undefined,
  parentId: string,
): void {
  requireDismissal(ownRequest(request, parentId));
}

/** The admin's 「知道了」: on the family's approved, rejected and expired requests. */
export function requireAdminDismissal(request: RequestState | undefined, familyId: string): void {
  requireDismissal(familyRequest(request, familyId));
}

/** A request read back right after it was written. */
function written<T>(record: T | undefined): T {
  if (record === undefined) {
    throw new Error('The join request just written was not found');
  }
  return record;
}

/** A request as its applicant sees it, with its time as an ISO date-time. */
export function toApplicantRequest(record: ApplicantRequestRecord): ApplicantJoinRequest {
  const { status } = record;
  if (status === 'withdrawn') {
    throw new Error('An applicant is not shown withdrawn requests');
  }
  return { ...record, status, createdAt: record.createdAt.toISOString() };
}

/** A pending request as its family's admin sees it, with the applicant's parent id. */
export function toPendingRequest(record: FamilyRequestRecord): PendingJoinRequest {
  const { id, parentId, name, email, createdAt } = record;
  return { id, parentId, name, email, createdAt: createdAt.toISOString() };
}

/** A closed request as its family's admin sees it among the handled ones. */
export function toHandledRequest(record: FamilyRequestRecord): HandledJoinRequest {
  const { id, parentId, name, email, status, closedAt } = record;
  if (status !== 'approved' && status !== 'rejected' && status !== 'expired') {
    throw new Error(`The admin is not shown ${status} requests as handled`);
  }
  if (closedAt === null) {
    throw new Error('A handled request has no closing time');
  }
  return { id, parentId, name, email, status, closedAt: closedAt.toISOString() };
}

/**
 * Locks the family of the request and reads the request again under the
 * lock, so the rules are checked against where the request stands after
 * the changes before this one: a request withdrawn, decided or expired a
 * moment ago is seen as closed. Undefined when there is no such request.
 */
async function lockRequest(
  store: JoinRequestStore,
  requestId: string,
): Promise<RequestState | undefined> {
  const request = await store.findRequest(requestId);
  if (request === undefined) {
    return undefined;
  }
  await store.lockFamily(request.familyId);
  return store.findRequest(requestId);
}

/** The admin's two ways of closing a pending request. */
export type Decision = Extract<JoinRequestStatus, 'approved' | 'rejected'>;

/**
 * Join requests to families (`.docs/design/interfaces.md`, "申请加入（申请人）"
 * and "新成员（管理员）"; `.docs/design/rules.md`, "加入申请"). A request is
 * pending until the admin approves or rejects it, the applicant withdraws it
 * or the family's code changes; each side then dismisses it on its own.
 * Every change locks the request's family first, as every change to a
 * family does, so the changes to one family run one after another.
 */
@Injectable()
export class JoinRequestsService {
  constructor(private readonly repository: JoinRequestsRepository) {}

  /**
   * The family the code belongs to and its admin, for the applicant to
   * confirm before applying; the admin's parent id gives their avatar its
   * colour.
   */
  async lookUp(parentId: string, code: string): Promise<FamilyCodeLookupResponse> {
    const family = await this.repository.findFamilyByCode(code);
    if (family === undefined) {
      throw codeNotFound();
    }
    await checkApplicable(this.repository, family.id, parentId);
    return { familyName: family.name, adminName: family.adminName, adminId: family.adminId };
  }

  /**
   * The parent applies to the family with the code, which is recorded with
   * the request. A request that loses a race with another one of the same
   * parent to the same family is answered as already pending.
   */
  async apply(parentId: string, code: string): Promise<ApplicantJoinRequest> {
    try {
      return await this.repository.transaction(async (store) => {
        const familyId = await store.lockFamilyByCode(code);
        if (familyId === undefined) {
          throw codeNotFound();
        }
        await checkApplicable(store, familyId, parentId);
        const requestId = await store.insertRequest({ familyId, parentId, code });
        return toApplicantRequest(written(await store.findApplicantRequest(requestId)));
      });
    } catch (error) {
      if (error instanceof RequestPendingError) {
        throw requestPending();
      }
      throw error;
    }
  }

  /** The parent's own requests the start page and the join page list, newest first. */
  async listOwn(parentId: string): Promise<ApplicantJoinRequest[]> {
    return (await this.repository.listApplicantRequests(parentId)).map(toApplicantRequest);
  }

  /** The applicant withdraws their own pending request. */
  withdraw(parentId: string, requestId: string): Promise<void> {
    return this.repository.transaction(async (store) => {
      requireWithdrawal(await lockRequest(store, requestId), parentId);
      await store.closeRequest(requestId, {
        status: 'withdrawn',
        closedAt: new Date(),
        closedBy: null,
      });
    });
  }

  /** The applicant's 「知道了」 on their own approved, rejected or expired request. */
  dismissOwn(parentId: string, requestId: string): Promise<void> {
    return this.repository.transaction(async (store) => {
      requireApplicantDismissal(await lockRequest(store, requestId), parentId);
      await store.dismissRequest(requestId, 'applicant', new Date());
    });
  }

  /** The family's pending requests and the handled ones its admin has not dismissed. */
  async listFamily(familyId: string): Promise<FamilyJoinRequestsResponse> {
    const [pending, handled] = await Promise.all([
      this.repository.listPendingRequests(familyId),
      this.repository.listHandledRequests(familyId),
    ]);
    return { pending: pending.map(toPendingRequest), handled: handled.map(toHandledRequest) };
  }

  /**
   * The admin approves or rejects a pending request of the family; an
   * approved applicant becomes a member in the same transaction.
   */
  decide(
    adminId: string,
    familyId: string,
    requestId: string,
    decision: Decision,
  ): Promise<HandledJoinRequest> {
    return this.repository.transaction(async (store) => {
      await lockFor(store, familyId, adminId, 'admin');
      const request = requireDecision(await store.findRequest(requestId), familyId);
      await store.closeRequest(requestId, {
        status: decision,
        closedAt: new Date(),
        closedBy: adminId,
      });
      if (decision === 'approved') {
        await store.insertMember(familyId, request.parentId, 'member');
      }
      return toHandledRequest(written(await store.findFamilyRequest(requestId)));
    });
  }

  /** The admin's 「知道了」 on a handled request of the family. */
  dismissForFamily(adminId: string, familyId: string, requestId: string): Promise<void> {
    return this.repository.transaction(async (store) => {
      await lockFor(store, familyId, adminId, 'admin');
      requireAdminDismissal(await store.findRequest(requestId), familyId);
      await store.dismissRequest(requestId, 'admin', new Date());
    });
  }
}
