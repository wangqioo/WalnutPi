package walnutpi.action

default allow := false
default status := "refused"
default reason := "policy-refused"

allow if {
	input.action.mode == "remote"
	not input.action.confirmationRequired
	input.action.risk != "high"
	input.executor_allowed
}

status := "allow" if allow

status := "pending" if {
	input.action.confirmationRequired
	input.executor_allowed
}

reason := "local-action-allowed" if allow

reason := "explicit-confirmation-required" if {
	status == "pending"
}

reason := "executor-not-allowed" if {
	not input.executor_allowed
}

reason := "unknown-action" if {
	not input.action.known
}
