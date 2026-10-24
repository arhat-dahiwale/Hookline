'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authClient } from '@/lib/auth-client';

interface MemberRow {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

/**
 * Members management through the Better Auth organization client. Invite
 * permissions are enforced by the server (admins invite; owners manage
 * owners).
 */
export default function MembersPage() {
  // Better Auth 1.7 has no useListMembers hook; the action call goes through
  // TanStack Query so this stays server state (never Zustand).
  const members = useQuery({
    queryKey: ['better-auth', 'members'],
    queryFn: async () => {
      const { data, error } = await authClient.organization.listMembers({ query: { limit: 100 } });
      if (error) throw new Error(error.message ?? 'Could not list members');
      return (data?.members ?? []) as MemberRow[];
    },
  });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const invite = async (): Promise<void> => {
    setInviteError(null);
    setInviting(true);
    const { error } = await authClient.organization.inviteMember({ email, role });
    setInviting(false);
    if (error) {
      setInviteError(error.message ?? 'Invite failed.');
      return;
    }
    setInviteOpen(false);
    setEmail('');
    await members.refetch();
  };

  const remove = async (memberId: string, name: string): Promise<void> => {
    if (!window.confirm(`Remove ${name} from this organization?`)) return;
    await authClient.organization.removeMember({ memberIdOrEmail: memberId });
    await members.refetch();
  };

  if (members.isPending) return <LoadingBlock label="Loading members" />;
  if (members.isError) {
    return (
      <ErrorBlock
        title="Could not load members"
        error={members.error}
        onRetry={() => void members.refetch()}
      />
    );
  }
  const rows = members.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">
            People with access to this organization (role: admin to invite).
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button data-testid="invite-member">
              <UserPlus aria-hidden /> Invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription>
                They receive an invitation to join this organization.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as 'admin' | 'member')}
                >
                  <SelectTrigger aria-label="Invite role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">member</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {inviteError ? (
                <p role="alert" className="text-sm text-destructive" data-testid="invite-error">
                  {inviteError}
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void invite()}
                  disabled={inviting || email === ''}
                  data-testid="invite-submit"
                >
                  {inviting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  Invite
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock
          title="No members"
          description="Invite teammates so they can manage endpoints and events."
          testId="members-empty"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody data-testid="members-table">
              {rows.map((member) => (
                <tr key={member.id} className="border-t">
                  <td className="px-4 py-3">
                    <span className="font-medium">{member.user.name}</span>
                    <span className="block text-xs text-muted-foreground">{member.user.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{member.role}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void remove(member.id, member.user.name)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
