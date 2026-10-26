import type { HostSessionTracker } from './host-tracker.js';
/** rc.3 public scoped waterfalls: user-questions/request and approval/request. */
export declare class WorkbenchInteractions {
    private readonly tracker;
    private live;
    constructor(ctx: any, tracker: HostSessionTracker);
    private capture;
    pending(): any[];
    respond(input: any): void;
    respondText(text: string): void;
}
//# sourceMappingURL=interactions.d.ts.map