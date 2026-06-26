package walnutpi.action

default allow := false
default status := "refused"
default reason := "policy-refused"

allow if {
	input.action.mode == "remote"
	not input.action.confirmationRequired
	input.action.risk != "high"
	input.executor_allowed
	subject_authorized
	device_bound
}

allow if {
	input.request.operation == "tools/call"
	input.subject.approvalTokenProof == true
	input.action.confirmationRequired
	input.action.mode == "confirmable"
	input.executor_allowed
	subject_authorized
	device_bound
}

subject_authorized if {
	input.subject.authenticated == true
	input.subject.roles[_] == "owner"
}

device_bound if {
	input.environment.deviceProfile == "device"
	input.environment.deviceId == input.subject.deviceId
	input.environment.orgId == input.subject.orgId
	input.environment.deviceId != null
	input.environment.orgId != null
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

reason := "subject-not-authorized" if {
	input.executor_allowed
	not subject_authorized
}

reason := "device-binding-required" if {
	input.executor_allowed
	subject_authorized
	not device_bound
}

reason := "unknown-action" if {
	not input.action.known
}
