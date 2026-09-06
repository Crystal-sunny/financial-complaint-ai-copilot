# GLM V6 冻结留出集计分卡

- 数据集：model-candidates-v6.0
- 模型：glm-5.3-flash
- 端到端完成：12/12（100.0%）
- 机器通过：9/12（75.0%）
- 模型请求尝试：36
- 已返回校验元数据的 Token：输入 113582，输出 54116
- 独立人工语义复核：未完成

| 样本 | 批次 | 状态 | 机器结果 | 证据门 | 动作／失败 |
|---|---|---|---|---|---|
| EVAL-V6-001 | holdout-1 | COMPLETED | 通过 | INSUFFICIENT | REQUEST_INFORMATION |
| EVAL-V6-005 | holdout-1 | COMPLETED | 失败 | SUFFICIENT | EXPLAIN_NO_ERROR |
| EVAL-V6-009 | holdout-1 | COMPLETED | 失败 | MANDATORY_ESCALATION | ESCALATE_SECURITY |
| EVAL-V6-002 | holdout-2 | COMPLETED | 通过 | INSUFFICIENT | REQUEST_INFORMATION |
| EVAL-V6-006 | holdout-2 | COMPLETED | 通过 | INSUFFICIENT | REQUEST_INFORMATION |
| EVAL-V6-010 | holdout-2 | COMPLETED | 通过 | MANDATORY_ESCALATION | ESCALATE_SECURITY |
| EVAL-V6-003 | holdout-3 | COMPLETED | 失败 | SUFFICIENT | MANUAL_REVIEW |
| EVAL-V6-007 | holdout-3 | COMPLETED | 通过 | INSUFFICIENT | REQUEST_INFORMATION |
| EVAL-V6-011 | holdout-3 | COMPLETED | 通过 | MANDATORY_ESCALATION | ESCALATE_SECURITY |
| EVAL-V6-004 | holdout-4 | COMPLETED | 通过 | INSUFFICIENT | MANUAL_REVIEW |
| EVAL-V6-008 | holdout-4 | COMPLETED | 通过 | INSUFFICIENT | REQUEST_INFORMATION |
| EVAL-V6-012 | holdout-4 | COMPLETED | 通过 | SUFFICIENT | PROPOSE_REFUND |

> V6 在首次模型请求前冻结，并且本轮没有按结果修改提示词或重跑失败样本；但样本仍由项目开发方编写，不是独立机构基准。机器通过不能替代人工语义复核，失败运行缺失的 Token 元数据不计入合计。
