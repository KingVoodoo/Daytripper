// A standalone map belongs to this local Windows profile, independently of EVE login.
const access = {backendAllowed:true,subjectKey:'local',grantKey:'daytripper-local',revision:0};
export const currentBackendAccess = () => access;
export const requireBackendAccess = async () => access;
export const backendGrantKey = (_?: unknown): string | null => access.grantKey;
export const watchBackendAccess = (_: (value: typeof access)=>void) => () => {};
