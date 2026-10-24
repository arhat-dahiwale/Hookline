'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  KeyRound,
  LayoutDashboard,
  Menu,
  Send,
  Settings,
  Users,
  Webhook,
  X,
  Zap,
} from 'lucide-react';

import { OrgSwitcher } from '@/components/org-switcher';
import { ThemeToggle } from '@/components/theme-script';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: '/overview', label: 'Overview', icon: <LayoutDashboard aria-hidden /> },
  { href: '/endpoints', label: 'Endpoints', icon: <Webhook aria-hidden /> },
  { href: '/events', label: 'Events', icon: <Zap aria-hidden /> },
  { href: '/deliveries', label: 'Deliveries', icon: <Send aria-hidden /> },
  { href: '/api-keys', label: 'API keys', icon: <KeyRound aria-hidden /> },
  { href: '/members', label: 'Members', icon: <Users aria-hidden /> },
  { href: '/settings', label: 'Settings', icon: <Settings aria-hidden /> },
];

/**
 * Dashboard chrome: sidebar navigation, org switcher and theme toggle. The
 * sidebar collapses on small screens into a toggleable drawer.
 */
export function DashboardShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-2" aria-label="Dashboard">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={pathname === item.href ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            pathname === item.href
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b bg-background px-4 md:hidden">
        <Link href="/overview" className="font-semibold">
          Hookline
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}
        </Button>
      </header>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-4 border-r bg-background p-4 transition-transform md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0 pt-16 md:pt-4' : '-translate-x-full',
        )}
      >
        <Link href="/overview" className="hidden px-2 text-lg font-semibold md:block">
          Hookline
        </Link>
        <OrgSwitcher userName={userName} />
        {nav}
        <div className="mt-auto flex items-center justify-between px-2 text-xs text-muted-foreground">
          <span data-testid="sidebar-user">{userName}</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Backdrop for the mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          aria-hidden
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <main className="flex-1 px-4 pb-8 pt-16 md:px-8 md:pt-8">{children}</main>
    </div>
  );
}
