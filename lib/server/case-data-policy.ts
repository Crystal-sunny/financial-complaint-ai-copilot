import type { ProviderMode } from '../domain';

// Standing authorization: on 2026-09-05 the owner authorized automatic GLM use
// for AI work on registered synthetic/desensitized project cases, and later
// explicitly confirmed the frozen EVAL-V4 set. Registration remains a technical
// data-boundary; it is not delegated to client requests.
const authorizedCaseIds = new Set([
  'CMP-2026-09001',
  'CMP-2026-09002',
  'CMP-2026-09003',
]);

function isRegisteredSyntheticCase(caseId: string) {
  return (
    authorizedCaseIds.has(caseId) ||
    /^EVAL-V(?:2|3|4)-(?:00[1-9]|01[0-2])$/.test(caseId)
  );
}

export function getCaseDataTransmissionStatus(): 'allowed' | 'paused' {
  // Operational kill switch can restrict consent, never expand its scope.
  return process.env.GLM_CASE_DATA_PAUSED === 'true' ? 'paused' : 'allowed';
}

export class CaseDataTransmissionPausedError extends Error {
  readonly code = 'CASE_DATA_TRANSMISSION_PAUSED';

  constructor() {
    super('当前模型或案件的外发未启用；请使用稳定模式。');
    this.name = 'CaseDataTransmissionPausedError';
  }
}

export function assertInvestigationProviderAllowed(
  provider: ProviderMode,
  caseId: string,
) {
  if (provider === 'recorded') return;
  if (
    provider !== 'glm' ||
    !isRegisteredSyntheticCase(caseId) ||
    getCaseDataTransmissionStatus() === 'paused'
  )
    throw new CaseDataTransmissionPausedError();
}
