export declare class WorkbenchError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
export declare class NotFoundError extends WorkbenchError {
    constructor(entity: string, id: string);
}
export declare class ConflictError extends WorkbenchError {
    constructor(entity: string, id: string, expectedRevision: number, currentRevision: number);
}
export declare class ValidationError extends WorkbenchError {
    constructor(message: string);
}
export declare class CircularDependencyError extends ValidationError {
    constructor(cycle: string[]);
}
export declare class UnknownOutcomeError extends WorkbenchError {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map