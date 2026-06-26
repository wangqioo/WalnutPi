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

allow if {
	input.request.operation == "tools/call"
	input.subject.approvalTokenProof == true
	input.action.confirmationRequired
	input.action.mode == "confirmable"
	input.executor_allowed
}

status := "allow" if allow

status := "pending" if {
	not allow
	input.action.confirmationRequired
	input.executor_allowed
}

reason := "local-action-allowed" if {
	allow
	not input.action.confirmationRequired
}

reason := "approved-confirmable-action" if {
	allow
	input.action.confirmationRequired
}

reason := "explicit-confirmation-required" if {
	not allow
	status == "pending"
}

reason := "executor-not-allowed" if {
	not input.executor_allowed
}

reason := "unknown-action" if {
	not input.action.known
}
