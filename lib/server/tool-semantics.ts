// Application-owned field definitions, not case-specific conclusions. No IDs,
// expected action labels, or fabricated transaction-to-reversal links here.
export const paymentRecordSemantics = {
  status: {
    SUCCESS: '最终交易成功。',
    SUCCESS_AFTER_TIMEOUT:
      '初始请求超时，但随后收到最终成功结果；不等于最终失败。',
    PROCESSING: '尚在处理中，不能解释为已经完成或到账。',
    TIMEOUT: '当前操作等待回执超时；仅凭超时不能推定资金交易最终失败。',
  },
  timestamps: {
    initiatedAt: '该记录对应操作的发起时间。',
    completedAt: '该操作最终完成时间；null 表示未记录完成时间。',
    statusUpdatedAt: '该实体状态更新时间，不一定对应另一笔交易的完成时间。',
  },
  relation:
    'relatedScheduleId 关联应收项；多笔交易可指向同一应收项。没有明确原交易关联字段时，不得虚构某笔冲正与某一原交易的一对一关系。',
} as const;
