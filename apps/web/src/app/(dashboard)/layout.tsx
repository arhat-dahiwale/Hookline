import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard-shell';
import { getServerSession } from '@/lib/server-session';

/**
 * Server-side protection: even if the edge middleware cookie check passes,
 * a real session must resolve before the dashboard shell renders.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) {
    redirect('/sign-in');
  }
  return <DashboardShell userName={session.user.name}>{children}</DashboardShell>;
}
