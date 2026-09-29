// PDFium's permission check before any extraction or conversion (M4-04,
// ADR-009 decision 3, D-19, rule 9): PDF Oxide ignores permission flags, so
// the Work worker reads them from its own PDFium copy (owner-unlocked copies
// report every bit) and refuses before Oxide ever sees the document.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { allows, type Capability, type Security } from '../../model/permissions';
import { rawCall } from '../render/pdfium';

/** Error code of a refused job; the UI shows the capability's usual reason. */
export const DENIED = 'permission-denied';

export function securityOf(mod: WrappedPdfiumModule, docPtr: number): Security {
  return {
    permissions: rawCall(mod, 'FPDF_GetDocPermissions', docPtr) >>> 0,
    revision: rawCall(mod, 'FPDF_GetSecurityHandlerRevision', docPtr),
  };
}

export function requireCapability(security: Security, cap: Capability): void {
  if (!allows(security, cap))
    throw new RpcError(`${DENIED}:${cap}`, `The document does not allow ${cap}`);
}
