import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/server-session';

export default async function RootPage() {
  const session = await getServerSession();
  redirect(session ? '/overview' : '/sign-in');
}
