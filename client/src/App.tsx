import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PageFrame, marketingShellClass } from "@/components/AgriShell";
import Home from "@/pages/Home";
import Marketplace from "@/pages/Marketplace";
import NotFound from "@/pages/NotFound";

const About = lazy(() => import("@/pages/About"));
const Auth = lazy(() => import("@/pages/Auth"));
const AuditLogs = lazy(() => import("@/pages/AuditLogs"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Activity = lazy(() => import("@/pages/Activity"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
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
    <main className={`${marketingShellClass} grid min-h-[40vh] place-items-center py-16 text-sm text-[#647568]`}>
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
      <Route path="/marketplace" component={Marketplace}/>
      <Route path="/products/:id">{() => <LazyPage><ProductDetails/></LazyPage>}</Route>
      <Route path="/orders/:id">{() => <LazyPage><OrderDetail/></LazyPage>}</Route>
      <Route path="/cooperatives/:slug">{() => <LazyPage><CooperativePage/></LazyPage>}</Route>
      <Route path="/activity">{() => <LazyPage><Activity/></LazyPage>}</Route>
      <Route path="/messages">{() => <LazyPage><Messages/></LazyPage>}</Route>
      <Route path="/profile">{() => <LazyPage><Profile/></LazyPage>}</Route>
      <Route path="/support">{() => <LazyPage><Support/></LazyPage>}</Route>
      <Route path="/support-tickets">{() => <LazyPage><SupportTickets/></LazyPage>}</Route>
      <Route path="/reports">{() => <LazyPage><Reports/></LazyPage>}</Route>
      <Route path="/admin/payment-options">{() => <LazyPage><PaymentOptions/></LazyPage>}</Route>
      <Route path="/admin/audit-logs">{() => <LazyPage><AuditLogs/></LazyPage>}</Route>
      <Route path="/dashboard">{() => <LazyPage><Dashboard/></LazyPage>}</Route>
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
          <Toaster richColors position="top-right"/>
          <Router/>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
