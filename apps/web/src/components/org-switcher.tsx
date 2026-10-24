'use client';

import { ChevronsUpDown, Building2, Plus, LogOut, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';

/**
 * Active-organization switcher (Better Auth organization plugin). Switching
 * invalidates every tRPC query: all dashboard data is org-scoped.
 */
export function OrgSwitcher({ userName }: { userName: string }) {
  const router = useRouter();
  const organizations = authClient.useListOrganizations();
  const active = authClient.useActiveOrganization();
  const [switching, setSwitching] = useState(false);

  const list = organizations.data ?? [];
  const activeOrg = active.data;

  const switchOrg = async (organizationId: string): Promise<void> => {
    setSwitching(true);
    await authClient.organization.setActive({ organizationId });
    router.refresh();
    // Refetch all org-scoped queries after the active org changes.
    window.dispatchEvent(new CustomEvent('hookline:org-switched'));
    setSwitching(false);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          aria-label="Switch organization"
          data-testid="org-switcher"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0" aria-hidden />
            <span className="truncate text-sm">
              {activeOrg?.name ?? 'No organization selected'}
            </span>
          </span>
          {switching ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {list.map((org) => (
          <DropdownMenuItem
            key={org.id}
            data-testid={`org-option-${org.slug ?? org.id}`}
            onClick={() => void switchOrg(org.id)}
          >
            <Building2 className="size-4" aria-hidden />
            <span className="truncate">{org.name}</span>
            {activeOrg?.id === org.id ? (
              <span className="ml-auto text-xs text-muted-foreground">active</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            router.push('/sign-in');
          }}
        >
          <LogOut className="size-4" aria-hidden />
          Sign out ({userName})
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Plus className="size-4" aria-hidden />
          New organization (Phase 8)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
