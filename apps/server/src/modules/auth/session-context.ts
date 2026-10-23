export type OrgRole = 'owner' | 'admin' | 'member';

/** Resolved session shape shared by REST guards, tRPC context and WS. */
export interface SessionContext {
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId: string | null;
    expiresAt: Date;
  };
}

const ROLE_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function parseOrgRole(value: string): OrgRole | null {
  if (value === 'owner' || value === 'admin' || value === 'member') return value;
  return null;
}
