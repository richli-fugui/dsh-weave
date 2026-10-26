export declare const RELAY_METHOD = "workbench.api.v1";
export declare const WORKBENCH_VERSION = "0.1.3";
export declare const API_ROUTES: readonly [readonly ["GET", "projects"], readonly ["POST", "projects"], readonly ["GET", "tasks"], readonly ["POST", "tasks"], readonly ["POST", "tasks/update"], readonly ["GET", "capabilities"], readonly ["POST", "runs/start"], readonly ["GET", "events"], readonly ["GET", "assistant"], readonly ["GET", "context"], readonly ["GET", "control/snapshot"], readonly ["POST", "control/stop"], readonly ["GET", "control/uncertain"], readonly ["POST", "control/reconcile"], readonly ["POST", "control/abandon"], readonly ["GET", "chat/messages"], readonly ["POST", "chat/send"], readonly ["GET", "interactions"], readonly ["POST", "interactions/respond"]];
export interface ApiRoute {
    method: 'GET' | 'POST';
    path: string;
    handler: (req: any, res: any) => any;
}
export declare function resolveWorkbenchMode(platform: string, mode?: 'auto' | 'host' | 'client'): 'host' | 'client';
/** The same authenticated local HTTP surface is used by the Windows authority and Mac relay. */
export declare function mountWorkbenchRoutes(ctx: any, routes: ApiRoute[]): void;
/** Registers one finite extension endpoint through Remote Connect's public HostServer API. */
export declare function bindWorkbenchExtension(ctx: any, routes: ApiRoute[], getService: (name: string) => any): void;
/** Mac Node half: relay only. Does not open SQLite, seed projects, register tools or execute work. */
export declare function applyWorkbenchRelay(ctx: any, getService: (name: string) => any): void;
//# sourceMappingURL=remoteconnect-relay.d.ts.map