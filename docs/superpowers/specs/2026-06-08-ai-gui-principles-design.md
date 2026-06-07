# AI GUI Principles Design

## Purpose

This document defines product principles for GUI design in the AI era, using WalnutPi as the grounding sample.

It is not an implementation plan for one screen. It is a design standard for judging whether an interface is merely a chat wrapper or a real AI-native GUI.

## Core Position

AI-era GUI is not a chat box placed beside old software. It is an interface where human intent, AI planning, system execution, and user supervision live together.

Traditional GUI assumes the user knows where the feature is and how to perform each step. AI GUI changes that assumption: the user may state a goal, and the system may translate that goal into plans and actions.

Once the system can act, the GUI gains new responsibilities:

- explain what the AI understood
- show what it plans to do
- separate low-risk and high-risk actions
- show execution evidence
- let the user stop, inspect, retry, or take over

Two patterns are explicitly not enough:

- Chat wrapper: the AI can talk, but cannot operate or inspect the real system.
- Tool-button panel: old functions are renamed as AI buttons, but the user still has to understand the system structure.

A real AI GUI is:

```text
intent interface + plan interface + execution scene + risk confirmation + takeover path
```

## Target Users

The default user is a normal person who does not know Linux commands and should not need to understand system internals before asking the device to do something.

Expert and maker workflows still matter, but they should live as progressive disclosure:

- first layer: plain-language intent and understandable result
- second layer: plan, status, command output, logs
- third layer: terminal, configuration, manual recovery

The product should not force beginner and expert users into the same surface. It should let them move between layers without changing the underlying agent.

## AI Role

To the user, AI should appear as an operator: it understands goals, plans steps, executes safe actions, and asks for confirmation when risk is high.

Inside the system, AI is an intelligent layer: it organizes commands, state, tools, confirmation dialogs, terminal output, summaries, and recovery flows.

This distinction matters. If AI is only presented as a helper, the interface tends to stop at advice. If AI is only hidden as system automation, the user loses trust. A useful AI GUI presents AI as an operator while exposing enough system evidence to keep it accountable.

## Principles

### 1. Intent First, Not Feature First

The user should start from what they want to achieve, not from where a feature is located.

Bad pattern:

- Status button
- Network button
- GPIO button
- Notes button
- AI button

Better pattern:

```text
What do you want WalnutPi to do?
```

The system should infer whether the request is status, network, notes, GPIO inspection, or cloud reasoning.

### 2. Chat Is an Input Channel, Not the GUI

A chat box can be useful, but it is not the whole interface.

The GUI must also contain:

- interpreted intent
- planned steps
- current execution state
- result evidence
- risk confirmation
- details and takeover controls

If the user can only keep asking follow-up questions, the interface is still a chat product, not an AI GUI.

### 3. AI Is an Operator to Users and a System Layer Internally

The user should feel that the device is doing work on their behalf, not merely answering.

The system should route intent through local capabilities when appropriate:

- system status
- network checks
- time and weather
- notes
- hardware read-only inspection
- terminal commands under controlled boundaries

AI should not pretend that it executed an action. If an action happened, the GUI should show the real output. If no action happened, the GUI should say so.

### 4. Every Action Needs a Visible Plan

AI should not jump from request to result when operating a real system.

For a request like:

```text
核桃派现在还好吗？
```

The interface should show a plan such as:

- check whether the device is reachable
- read uptime, memory, and disk
- check important services
- summarize warnings

The plan does not need to expose every internal detail by default, but it must be visible enough for the user to understand what the AI is about to do or has already done.

### 5. Risk Grading Is the Safety Baseline

AI GUI must classify actions by risk.

Read-only and low-risk actions may run automatically:

- check status
- read network information
- query time or weather
- read notes
- inspect GPIO and bus configuration

High-risk or side-effecting actions must require explicit confirmation:

- enable GPIO output
- change overlays
- install or remove packages
- restart services
- reboot or shut down
- delete files
- write firmware
- modify EMMC or boot configuration

The confirmation must explain what will change, what can break, and how to recover or stop.

### 6. Evidence Matters More Than Polished Replies

AI saying "done" is not enough.

The GUI should show evidence:

- target device
- timestamp
- command or API action
- raw output or summarized output
- status before and after
- error stage if something failed

For real devices, evidence is the trust layer. Without it, the interface becomes an unverified narrator.

### 7. Expert Users Must Be Able to Take Over

AI GUI should not hide the terminal. It should place terminal access, logs, configuration, and manual commands in a second or third layer.

Takeover paths include:

- stop current task
- retry step
- open terminal
- copy command
- edit command before running
- inspect logs
- restore previous configuration

This keeps the beginner path simple while preserving control for developers and makers.

### 8. Multiple Surfaces, One Agent

Web, small screen, terminal, and voice should not become four separate products. They should be different surfaces of the same local agent.

Each surface has a different role:

- Web: full operation console with plan, confirmation, execution scene, terminal, and summary.
- Small screen: device state, AI activity, IP, warnings, and simple ambient feedback.
- Terminal: expert control, logs, recovery, and raw evidence.
- Voice: quick intent input for low-risk requests.

The task state should be shared across these surfaces when possible.

## WalnutPi As the Grounding Sample

WalnutPi is a strong sample because it is not just software and not just chat. It is a real headless Debian Linux device with:

- SSH
- Docker
- frpc
- network state
- filesystem state
- GPIO / I2C / SPI / UART boundaries
- audio experiments
- a small framebuffer / LVGL screen
- a browser-facing web console
- a terminal-first command hub

This makes the GUI problem concrete.

### Device State

WalnutPi has state that changes:

- online / offline
- IP address
- uptime
- memory
- disk
- Docker containers
- frpc status
- SSH status
- screen state
- audio state

AI GUI should not make the user infer these states from conversation. It should show them directly or expose them as evidence when a task depends on them.

### Actions Have Consequences

Some operations are safe:

- read status
- check network
- read notes
- inspect hardware configuration

Other operations can break the system:

- changing overlays
- writing GPIO outputs
- installing packages
- restarting services
- deleting files
- flashing firmware
- modifying EMMC or boot files

WalnutPi therefore needs risk grading as a product primitive, not as an implementation detail.

### Execution Needs Evidence

If the user asks:

```text
帮我看看核桃派现在还好吗
```

The ideal interface should not only answer:

```text
核桃派状态正常。
```

It should show:

- host name
- current IP
- uptime
- memory and disk summary
- service checks
- command output or summarized evidence
- time of check
- whether the result came from the live board

### Surface Roles

WalnutPi should use its surfaces deliberately.

#### Web Console

The web console is the full AI GUI:

- natural-language intent input
- interpreted intent
- visible plan
- risk confirmation
- progress
- execution evidence
- 3D or device presence
- terminal fallback

#### Small Screen

The small screen is not the full control surface. It is the device's face and dashboard:

- IP
- online state
- current AI task
- service warnings
- simple status cards
- ambient progress

It should make the device feel alive and inspectable without forcing all operations onto a tiny display.

#### Terminal

The terminal is the expert takeover and evidence layer:

- logs
- commands
- configuration
- recovery
- manual execution

AI GUI should integrate the terminal as a trustworthy layer, not treat it as a failure of design.

#### Voice

Voice is a fast intent channel:

```text
核桃派现在还好吗
记一下今天调好了 Wi-Fi
帮我看一下网络
```

Voice should not be the main confirmation surface for high-risk operations. High-risk operations should move to visible confirmation.

## Evaluation Checklist

### Not Yet AI GUI: Chat Wrapper

An interface is not yet AI GUI if:

- it only has a chat box
- it has no task state
- AI answers without real system state
- the user cannot see what AI did
- AI says "done" without evidence
- all functions still require the user to choose buttons manually
- low-risk and high-risk actions are treated the same
- failure gives no logs, stage, or recovery path
- expert users cannot take over

### Acceptable AI GUI: Supervised Action Interface

An acceptable AI GUI must:

- let the user express goals in natural language
- translate goals into visible plans
- show current execution step
- show result evidence
- auto-run only low-risk actions
- require confirmation for high-risk actions
- explain the risk before confirmation
- let the user expand details
- let the user stop, retry, or switch to manual control
- explain which stage failed when something goes wrong

### Excellent AI GUI: One Agent Across Surfaces

An excellent AI GUI should:

- share task state across web, small screen, terminal, and voice
- show device state on the small screen
- show plans and confirmation in the web console
- keep terminal access as expert control and evidence
- adapt interaction mode to risk
- remember useful context such as device history and common tasks
- compress complexity for normal users while preserving detail for experts
- expose the gap between AI's interpretation and the real system's feedback

## One-Sentence Test

If an interface only lets the user talk to AI, it is a chat interface. If it lets the user supervise AI safely operating a real system, it is an AI GUI.

## Out of Scope

This document does not define:

- the exact web console layout
- the final visual style
- the small-screen LVGL screen set
- the implementation plan
- deployment changes
- model prompts or API contracts

Those should be specified in separate implementation-oriented documents after this principle document is reviewed.
