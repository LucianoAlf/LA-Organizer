import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';

export function AppShell() {
  return (
    <div className="min-h-screen bg-bg-app text-fg flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-content mx-auto px-md pb-[88px] pt-md md:pb-md">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
