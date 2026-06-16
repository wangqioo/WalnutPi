# Separate human CLI commands from agent action commands

The `walnut` CLI has two roles: Human CLI Commands for people using the terminal directly, and Agent Action Commands for Walnut Agent Console or WalnutAI invocation. These roles can share implementation, but their contracts are different: human commands may be menus, TUI tools, demos, or shortcuts, while agent commands need stable identifiers, policy metadata, parameters, and machine-readable evidence.

**Consequences**

New `walnut` capabilities should explicitly choose whether they are human-facing, agent-facing, or both with separate contracts. The Walnut Agent Console should depend on Agent Action Commands governed by the Action Policy Manifest, not on terminal menus, interactive TUI flows, or arbitrary shell shortcuts.
