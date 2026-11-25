import { Injectable } from '@nestjs/common';
import { ChildrenService } from '../child/children.service.js';
import { FamiliesService } from '../family/families.service.js';

/**
 * Deleting a family at its admin's request (`.docs/design/interfaces.md`,
 * "DELETE /api/families/{familyId}"; decision 0038). The family module
 * deletes the family with everything in it in one transaction and records
 * it; once that has committed, the login links in Redis of the children
 * deleted with it are removed. A deletion that is refused or fails removes
 * no link.
 */
@Injectable()
export class FamilyDeletionService {
  constructor(
    private readonly families: FamiliesService,
    private readonly children: ChildrenService,
  ) {}

  async delete(parentId: string, familyId: string): Promise<void> {
    const childIds = await this.families.delete(parentId, familyId);
    await this.children.removeLoginLinksOf(childIds);
  }
}
