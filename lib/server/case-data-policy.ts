import type { ProviderMode } from '../domain';

// The owner has explicitly paused external case transmission. A configured
// credential is not consent. Keep this closed until permission is renewed;
// neither a browser request nor an environment variable can override the pause.
export const caseDataTransmissionStatus = 'paused' as const;

export class CaseDataTransmissionPausedError extends Error {
  readonly code = 'CASE_DATA_TRANSMISSION_PAUSED';

  constructor() {
    super('案件数据外发已暂停；当前仅可使用稳定模式。');
    this.name = 'CaseDataTransmissionPausedError';
  }
}

export function assertInvestigationProviderAllowed(provider: ProviderMode) {
  if (provider !== 'recorded') throw new CaseDataTransmissionPausedError();
}
