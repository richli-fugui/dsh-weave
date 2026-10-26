import type { WorkbenchDomain } from './domain.js';
import { DshHostSessionBridge } from './host-session.js';
import type { ControlSnapshot, StopResult } from '../../shared/types.js';
export interface PendingHostTurn {
    sessionId: string;
    requestId: string;
    intentId?: string;
    baselineMaxSeq: number;
    startedAt: string;
    status: 'running' | 'awaiting_input' | 'stopping' | 'unknown' | 'completed' | 'timeout' | 'error' | 'stopped';
    stopRequested?: boolean;
    lastQuestion?: string;
    lastReplyText?: string;
    interaction?: {
        id: string;
        kind: 'question' | 'approval';
        title: string;
        questions?: any[];
    };
}
export interface HostTrackerOptions {
    pollIntervalMs?: number;
    maxTrackingMs?: number;
}
export declare class HostSessionTracker {
    private readonly domain;
    private readonly getBridge;
    private activePendingTurn;
    private trackingTimer;
    private observationEpoch;
    private readonly pollIntervalMs;
    private readonly maxTrackingMs;
    constructor(domain: WorkbenchDomain, getBridge: () => DshHostSessionBridge | null, options?: HostTrackerOptions);
    private store;
    private markUnknown;
    recordTurnUncertain(requestId: string): void;
    recordInteraction(interaction: NonNullable<PendingHostTurn['interaction']>): void;
    interactionAnswered(id: string): void;
    abandonUnknown(expectedRequestId: string, confirmed: boolean, reason: string): void;
    /** Reconnection reconciles existing work; it never replays a prompt or cancel command. */
    reconcileOnStartup(): Promise<void>;
    private isCurrent;
    recordTurnStarted(info: {
        sessionId: string;
        requestId: string;
        intentId?: string;
        baselineMaxSeq: number;
    }): PendingHostTurn;
    recordTurnAwaitingInput(questionText: string, sessionId?: string, requestId?: string): Promise<void>;
    recordTurnCompleted(replyText?: string, requestId?: string): void;
    private collectIdle;
    startBackgroundTracking(sessionId: string, baselineMaxSeq: number, intentId?: string): void;
    private schedule;
    stopBackgroundTracking(): void;
    getPendingTurn(): PendingHostTurn | null;
    isHostSession(targetId: string): boolean;
    stopHostSession(targetId?: string, timeoutMs?: number): Promise<StopResult>;
    stopIntent(intentId: string, timeoutMs?: number): Promise<StopResult | null>;
    stopAll(timeoutMs?: number): Promise<StopResult>;
    augmentControlSnapshot(snapshot: ControlSnapshot): ControlSnapshot;
}
//# sourceMappingURL=host-tracker.d.ts.map