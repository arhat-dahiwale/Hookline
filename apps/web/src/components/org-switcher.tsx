'use client';

import { ChevronsUpDown, Building2, Plus, LogOut, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const createOrg = async (): Promise<void> => {
    setCreateError(null);
    setCreating(true);
    const slug =
      newName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `org-${Date.now()}`;
    const { error } = await authClient.organization.create({ name: newName, slug });
    setCreating(false);
    if (error) {
      setCreateError(error.message ?? 'Could not create the organization.');
      return;
    }
    setCreateOpen(false);
    setNewName('');
    router.refresh();
    window.dispatchEvent(new CustomEvent('hookline:org-switched'));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          // Accessible name must contain the visible text (axe
          // label-content-name-mismatch): the org name is what's on screen.
          aria-label={`Switch organization: ${activeOrg?.name ?? 'No organization selected'}`}
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
        <DropdownMenuItem data-testid="create-org-trigger" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          New organization
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            router.push('/sign-in');
          }}
        >
          <LogOut className="size-4" aria-hidden />
          Sign out ({userName})
        </DropdownMenuItem>
      </DropdownMenuContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Endpoints, events and keys are scoped to an organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Acme Inc"
              />
            </div>
            {createError ? (
              <p role="alert" className="text-sm text-destructive" data-testid="create-org-error">
                {createError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createOrg()}
              disabled={creating || newName.trim() === ''}
              data-testid="create-org-submit"
            >
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DropdownMenu>
  );
}
