export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled'
export type RunState = 'queued' | 'running' | 'stopping' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted' | 'unknown'
export type ReviewState = 'pending' | 'accepted' | 'rejected'
export type PriorityCode = 'urgent' | 'high' | 'normal' | 'low'

export interface Project {
  id: string
  title: string
  rootPath: string
  goal: string
  status: 'active' | 'archived'
  revision: number
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  projectId: string
  title: string
  goal: string
  acceptance: string
  statusCode: TaskStatus
  priorityCode: PriorityCode
  dependencies: string[]
  progressPercent: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface WorkIntent {
  id: string
  projectId?: string
  rawInput: string
  status: 'accepted' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed'
  controlEpoch: number
  createdAt: string
  updatedAt: string
}

export interface ControlSnapshot {
  activeCount: number
  queuedCount: number
  awaitingCount: number
  /** Executions requiring upstream reconciliation, never counted as confirmed stopped. */
  unknownCount?: number
  items: Array<{
    runId: string
    taskId: string
    taskTitle: string
    projectId: string
    state: RunState
    intentId?: string
  }>
}

export interface StopRequest {
  commandId: string
  target: {
    kind: 'run' | 'intent' | 'all'
    id?: string
  }
}

export interface StopResult {
  commandId: string
  status: 'received' | 'accepted' | 'stopping' | 'stopped' | 'already_terminal' | 'conflict' | 'waiting_tool_exit'
  stoppedRunIds: string[]
  pendingToolIds?: string[]
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
  intentId?: string
}

export interface Run {
  id: string
  taskId: string
  clientRequestId: string
  intentId?: string
  state: RunState
  workerSessionId?: string
  controlEpoch?: number
  startedAt: string
  finishedAt?: string
  outcome?: Record<string, unknown>
}

export interface ArtifactRef {
  title: string
  path: string
  kind?: string
}

export interface Result {
  id: string
  runId: string
  summary: string
  artifactRefs: ArtifactRef[]
  evidenceRefs: string[]
  nextActions: string[]
  reviewState: ReviewState
  createdAt: string
}

export interface AssistantState {
  stableId: string
  currentSessionId: string
  generation: number
  memoryIndex: Record<string, unknown>
  updatedAt: string
}

export interface OutboxEvent {
  sequence: number
  entityId: string
  type: string
  payload: Record<string, unknown>
  deliveryState: 'pending' | 'delivered'
  createdAt: string
}

export interface CreateProjectInput {
  id?: string
  title: string
  rootPath: string
  goal?: string
}

export interface UpdateProjectInput {
  id: string
  title?: string
  rootPath?: string
  goal?: string
  status?: 'active' | 'archived'
  expectedRevision: number
}

export interface CreateTaskInput {
  id?: string
  projectId: string
  title: string
  goal?: string
  acceptance?: string
  statusCode?: TaskStatus
  priorityCode?: PriorityCode
  dependencies?: string[]
}

export interface UpdateTaskInput {
  id: string
  title?: string
  goal?: string
  acceptance?: string
  statusCode?: TaskStatus
  priorityCode?: PriorityCode
  dependencies?: string[]
  progressPercent?: number
  expectedRevision: number
}

export interface StartRunInput {
  taskId: string
  clientRequestId: string
  workerSessionId?: string
  intentId?: string
}

export interface CompleteRunInput {
  runId: string
  state: 'completed' | 'failed' | 'interrupted'
  summary: string
  artifactRefs?: ArtifactRef[]
  evidenceRefs?: string[]
  nextActions?: string[]
  suggestedTaskStatus?: TaskStatus
  outcome?: Record<string, unknown>
}
