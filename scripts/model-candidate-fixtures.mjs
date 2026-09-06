import assert from 'node:assert/strict';
import { mockDatabase } from '../lib/server/mock-database.ts';

const identityFields = {
  transactions: 'transactionId',
  loans: 'loanId',
  schedules: 'scheduleId',
  rules: 'ruleId',
  tickets: 'ticketId',
  securityEvents: 'eventId',
};

// Offline preparation only. Does not call the investigation pipeline or provider.
export function prepareCandidate(sample) {
  assert.match(sample.id, /^EVAL-V2-\d{3}$/);
  const database = structuredClone(mockDatabase);
  const base = database.cases.find((item) => item.caseId === sample.baseCaseId);
  assert.ok(base, 'Unknown base case');
  const context = {
    caseId: sample.id,
    customerId: base.customerId,
    loanId: base.loanId,
    receivedAt: base.receivedAt,
    channel: base.channel,
    rawText: sample.rawText,
    customerRequests: [sample.rawText],
  };
  assert.ok(context.rawText.trim());
  for (const [key, value] of Object.entries(sample.casePatch ?? {})) {
    assert.ok(['loanId', 'receivedAt'].includes(key));
    context[key] = value;
  }
  for (const patch of sample.overrides) {
    const identity = identityFields[patch.collection];
    assert.ok(identity, 'Unknown data collection');
    const records = database[patch.collection];
    const index = records.findIndex((record) => record[identity] === patch.id);
    assert.ok(index >= 0, 'Unknown record');
    if (patch.remove) records.splice(index, 1);
    else
      for (const [key, value] of Object.entries(patch.changes)) {
        assert.ok(
          Object.hasOwn(records[index], key) && key !== identity,
          'Unknown or identity field patch',
        );
        records[index][key] = structuredClone(value);
      }
  }
  for (const ticket of database.tickets)
    if (ticket.linkedCaseId === base.caseId)
      ticket.linkedCaseId = context.caseId;
  const forcedToolErrors = [...(sample.forcedToolErrors ?? [])];
  assert.ok(
    forcedToolErrors.every((name) => name === 'get_payment_transactions'),
  );
  return { case: context, database, forcedToolErrors };
}
