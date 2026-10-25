# Software Factory Architecture & State Machine

`mermaid
stateDiagram-v2
    [*] --> ANALYSIS
    ANALYSIS --> RESEARCH : record-analysis
    RESEARCH --> PLAN : record-research
    PLAN --> ORACLE_SETUP : record-plan
    ORACLE_SETUP --> EXECUTE : lock-oracle (SHA-256)
    EXECUTE --> AUDIT_GATE : record-execute
    AUDIT_GATE --> EXECUTE : REJECTED (Attempt < 5)
    AUDIT_GATE --> PLAN : Circuit Breaker (Attempt == 5)
    AUDIT_GATE --> CRITIC : APPROVED
    CRITIC --> ORACLE_SETUP : Next Step in Stage
    CRITIC --> AWAITING_STAGE_APPROVAL : All Steps Complete
    AWAITING_STAGE_APPROVAL --> [*] : approve-stage
`

## Circuit Breakers
- **Step Execution Retries:** Maximum of 5 attempts per step (Execute <-> Auditor), escalating to Model: pro on attempts 4 and 5.
- **Architectural Re-Plans:** Maximum of 2 re-plans per stage before pausing at HUMAN_INTERVENTION_REQUIRED.