export class WorkbenchError extends Error {
  constructor(message: string, public readonly code: string = 'DOMAIN_ERROR') {
    super(message)
    this.name = 'WorkbenchError'
  }
}

export class NotFoundError extends WorkbenchError {
  constructor(entity: string, id: string) {
    super(`${entity} with id '${id}' not found`, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends WorkbenchError {
  constructor(entity: string, id: string, expectedRevision: number, currentRevision: number) {
    super(
      `Conflict updating ${entity} '${id}': expected revision ${expectedRevision}, but current is ${currentRevision}`,
      'CONFLICT',
    )
    this.name = 'ConflictError'
  }
}

export class ValidationError extends WorkbenchError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class CircularDependencyError extends ValidationError {
  constructor(cycle: string[]) {
    super(`Circular task dependency detected: ${cycle.join(' -> ')}`)
    this.name = 'CircularDependencyError'
  }
}

export class UnknownOutcomeError extends WorkbenchError {
  constructor(message: string) {
    super(message, 'UNKNOWN_OUTCOME')
    this.name = 'UnknownOutcomeError'
  }
}
