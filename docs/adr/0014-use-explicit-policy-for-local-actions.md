# Use explicit policy for local actions

WalnutPi uses an explicit Local Action Policy to decide which Local Actions may run directly, require confirmation, or must be refused. Intent recognition may use hard-coded rules, allowlists, risk categories, or AI-assisted routing, but execution authority must come from an auditable policy layer rather than from a model freely choosing commands.

**Consequences**

The current rule-based routing is an engineering shortcut for speed and safety, not the final domain model. Local action definitions, risk classes, confirmation requirements, allowed executors, and evidence shapes should be consolidated into one policy source used by the Web server, WalnutAI, and `walnut action`; new actions should not be added as separate hard-coded branches in each surface. Common local actions should keep a local fast path through the policy source, with AI-assisted routing reserved for ambiguous language rather than required before every device action. The project should move directly to the policy source rather than preserving a compatibility layer for scattered legacy routing, while preserving the default that high-risk actions cannot run without explicit confirmation.
