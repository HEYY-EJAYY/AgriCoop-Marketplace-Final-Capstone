import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { NotificationBell, ProfileMenu } from "@/components/AgriShell";
import { BrandMark } from "@/components/AgriShell";
import { adminNavBadges, usePendingCounts } from "@/lib/usePendingCounts";
import { adminNavForRole, adminNavItemForLocation } from "@/navigation/adminNav";
import { LogOut, UserRound } from "lucide-react";
import { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";

function navHref(item: { section?: string; href?: string }): string {
  if (item.href) return item.href;
  return `/dashboard?section=${item.section ?? "overview"}`;
}

function SidebarBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <>
      <span
        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#a34838] px-1 text-[10px] font-extrabold text-white group-data-[collapsible=icon]:hidden"
        aria-label={`${count} pending`}
      >
        {label}
      </span>
      <span
        className="absolute right-1.5 top-1.5 hidden h-2 w-2 rounded-full bg-[#a34838] group-data-[collapsible=icon]:block"
        aria-hidden
      />
    </>
  );
}

function AdminShellContent({ role, children }: { role: "admin" | "superadmin"; children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const items = adminNavForRole(role);
  const { counts } = usePendingCounts(true);
  const badges = adminNavBadges(counts, role);
  const activeItem = adminNavItemForLocation(items, location, search);
  const pageTitle = activeItem?.label ?? "Dashboard";

  return (
    <>
      <Sidebar collapsible="icon" className="border-r border-[#dde4d9] bg-[#fffdf8]">
        <SidebarHeader className="h-16 justify-center border-b border-[#e7ede3]">
          <div className="flex items-center gap-2 px-2">
            <BrandMark compact />
            <span className="group-data-[collapsible=icon]:hidden font-display text-sm font-bold text-[#174a31]">
              {role === "superadmin" ? "SuperAdmin" : "OfficerAdmin"}
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="px-2 py-2">
                {items.map(item => {
                  const href = navHref(item);
                  const isActive = activeItem?.id === item.id;
                  const isSection = Boolean(item.section);
                  const badge = badges[item.id] ?? 0;
                  const buttonClass = `h-10 font-normal relative${badge > 0 ? " pr-9 group-data-[collapsible=icon]:pr-2" : ""}`;
                  return (
                    <SidebarMenuItem key={item.id}>
                      {isSection ? (
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(href)}
                          tooltip={item.label}
                          className={buttonClass}
                        >
                          <item.icon className={`h-4 w-4 ${isActive ? "text-[#1f5a3c]" : ""}`} />
                          <span>{item.label}</span>
                          <SidebarBadge count={badge} />
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.label}
                          className={buttonClass}
                        >
                          <Link href={href} className="no-underline">
                            <item.icon className={`h-4 w-4 ${isActive ? "text-[#1f5a3c]" : ""}`} />
                            <span>{item.label}</span>
                            <SidebarBadge count={badge} />
                          </Link>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-[#e7ede3] p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-[#edf3e9] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4e8257] group-data-[collapsible=icon]:justify-center"
                aria-label="Account menu"
              >
                <Avatar className="h-9 w-9 shrink-0 border">
                  <AvatarFallback className="text-xs font-medium">
                    {user?.name?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-medium leading-none">{user?.name || "-"}</p>
                  <p className="mt-1 truncate text-xs text-[#6a796e]">
                    {role === "superadmin" ? "SuperAdmin" : "OfficerAdmin"}
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href="/profile" className="flex items-center">
                  <UserRound className="mr-2 h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void logout()}
                className="cursor-pointer text-[#a34838] focus:text-[#a34838]"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-[#f8f5ee]">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[#dde4d9] bg-[#fffdf8]/95 px-3 backdrop-blur sm:px-5">
          <SidebarTrigger className="h-9 w-9 rounded-lg" aria-label="Toggle navigation" />
          <h1 className="min-w-0 flex-1 truncate font-display text-base font-bold text-[#174a31] sm:text-lg">
            {pageTitle}
          </h1>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </>
  );
}

/**
 * Sidebar + topbar shell for OfficerAdmin and SuperAdmin surfaces.
 * Non-admin roles render children unchanged so shared pages can be wrapped safely.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading || !user) return <>{children}</>;
  if (user.role !== "admin" && user.role !== "superadmin") return <>{children}</>;
  return (
    <SidebarProvider>
      <AdminShellContent role={user.role}>{children}</AdminShellContent>
    </SidebarProvider>
  );
}
