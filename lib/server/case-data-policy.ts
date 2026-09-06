import type { ProviderMode } from '../domain';

// Owner explicitly authorized these three synthetic cases for GLM investigation
// and verification on 2026-09-04. This does not authorize other providers/cases.
const authorizedCaseIds = new Set([
  'CMP-2026-09001',
  'CMP-2026-09002',
  'CMP-2026-09003',
]);

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
    !authorizedCaseIds.has(caseId) ||
    getCaseDataTransmissionStatus() === 'paused'
  )
    throw new CaseDataTransmissionPausedError();
}
