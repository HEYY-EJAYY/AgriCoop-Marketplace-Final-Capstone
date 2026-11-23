import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { RealtimeInvalidator } from "./lib/useRealtimeInvalidation";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PageFrame, marketingShellClass } from "@/components/AgriShell";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";

const AdminShell = lazy(() => import("@/components/AdminShell"));
const Marketplace = lazy(() => import("@/pages/Marketplace"));

const About = lazy(() => import("@/pages/About"));
const Auth = lazy(() => import("@/pages/Auth"));
const AuditLogs = lazy(() => import("@/pages/AuditLogs"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Activity = lazy(() => import("@/pages/Activity"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const CoopAdminApplication = lazy(() => import("@/pages/CoopAdminApplication"));
const PaymentOptions = lazy(() => import("@/pages/PaymentOptions"));
const Reports = lazy(() => import("@/pages/Reports"));
const Support = lazy(() => import("@/pages/Support"));
const SupportTickets = lazy(() => import("@/pages/SupportTickets"));
const Messages = lazy(() => import("@/pages/Messages"));
const Profile = lazy(() => import("@/pages/Profile"));
const ProductDetails = lazy(() => import("@/pages/ProductDetails"));
const OrderDetail = lazy(() => import("@/pages/OrderDetail"));
const CooperativePage = lazy(() => import("@/pages/CooperativePage"));

const LazyFallback = (
  <PageFrame>
    <main className={`${marketingShellClass} grid min-h-[40vh] place-items-center py-16 text-sm text-[#5f7063]`}>
      Loading AgriCoop…
    </main>
  </PageFrame>
);

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={LazyFallback}>{children}</Suspense>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home}/>
      <Route path="/about">{() => <LazyPage><About/></LazyPage>}</Route>
      <Route path="/auth">{() => <LazyPage><Auth/></LazyPage>}</Route>
      <Route path="/checkout">{() => <LazyPage><Checkout/></LazyPage>}</Route>
      <Route path="/marketplace">{() => <LazyPage><Marketplace/></LazyPage>}</Route>
      <Route path="/products/:id">{() => <LazyPage><ProductDetails/></LazyPage>}</Route>
      <Route path="/orders/:id">{() => <LazyPage><OrderDetail/></LazyPage>}</Route>
      <Route path="/cooperatives/:slug">{() => <LazyPage><CooperativePage/></LazyPage>}</Route>
      <Route path="/activity">{() => <LazyPage><Activity/></LazyPage>}</Route>
      <Route path="/messages">{() => <LazyPage><Messages/></LazyPage>}</Route>
      <Route path="/profile">{() => <LazyPage><AdminShell><Profile/></AdminShell></LazyPage>}</Route>
      <Route path="/support">{() => <LazyPage><Support/></LazyPage>}</Route>
      <Route path="/support-tickets">{() => <LazyPage><AdminShell><SupportTickets/></AdminShell></LazyPage>}</Route>
      <Route path="/reports">{() => <LazyPage><AdminShell><Reports/></AdminShell></LazyPage>}</Route>
      <Route path="/admin/payment-options">{() => <LazyPage><AdminShell><PaymentOptions/></AdminShell></LazyPage>}</Route>
      <Route path="/admin/audit-logs">{() => <LazyPage><AdminShell><AuditLogs/></AdminShell></LazyPage>}</Route>
      <Route path="/dashboard">{() => <LazyPage><Dashboard/></LazyPage>}</Route>
      <Route path="/applications/cooperative-admin">{() => <LazyPage><CoopAdminApplication/></LazyPage>}</Route>
      <Route path="/404" component={NotFound}/>
      <Route component={NotFound}/>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <RealtimeInvalidator/>
          <Toaster richColors position="top-right"/>
          <Router/>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
