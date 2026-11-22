import { familyCodeSchema, idSchema } from '@thinklet/contracts';
import { NamingParamPipe } from '../../infrastructure/validation/naming-param.pipe.js';
import { codeNotFound, requestNotFound } from './join-requests.service.js';

/**
 * Reads the join request id of the path. A value that is not an id names no
 * request, so it is answered as a request that does not exist.
 */
export class RequestIdPipe extends NamingParamPipe<typeof idSchema> {
  constructor() {
    super(idSchema, requestNotFound);
  }
}

/**
 * Reads the family code of the path in capitals, as codes are matched
 * without regard to case. A value that cannot be a code is no family's
 * code, so it is answered as an unknown code.
 */
export class FamilyCodePipe extends NamingParamPipe<typeof familyCodeSchema> {
  constructor() {
    super(familyCodeSchema, codeNotFound);
  }
}
