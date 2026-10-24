export class WorkbenchError extends Error {
    code;
    constructor(message, code = 'DOMAIN_ERROR') {
        super(message);
        this.code = code;
        this.name = 'WorkbenchError';
    }
}
export class NotFoundError extends WorkbenchError {
    constructor(entity, id) {
        super(`${entity} with id '${id}' not found`, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}
export class ConflictError extends WorkbenchError {
    constructor(entity, id, expectedRevision, currentRevision) {
        super(`Conflict updating ${entity} '${id}': expected revision ${expectedRevision}, but current is ${currentRevision}`, 'CONFLICT');
        this.name = 'ConflictError';
    }
}
export class ValidationError extends WorkbenchError {
    constructor(message) {
        super(message, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
    }
}
export class CircularDependencyError extends ValidationError {
    constructor(cycle) {
        super(`Circular task dependency detected: ${cycle.join(' -> ')}`);
        this.name = 'CircularDependencyError';
    }
}
export class UnknownOutcomeError extends WorkbenchError {
    constructor(message) {
        super(message, 'UNKNOWN_OUTCOME');
        this.name = 'UnknownOutcomeError';
    }
}
//# sourceMappingURL=errors.js.map