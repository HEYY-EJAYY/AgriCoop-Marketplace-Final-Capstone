import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "@/pages/Home";
import Marketplace from "@/pages/Marketplace";
import Auth from "@/pages/Auth";
import ProductDetails from "@/pages/ProductDetails";
import About from "@/pages/About";
import NotFound from "@/pages/NotFound";

const Checkout = lazy(() => import("@/pages/Checkout"));
const Activity = lazy(() => import("@/pages/Activity"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AuditLogs = lazy(() => import("@/pages/AuditLogs"));
const PaymentOptions = lazy(() => import("@/pages/PaymentOptions"));
const Reports = lazy(() => import("@/pages/Reports"));
const Support = lazy(() => import("@/pages/Support"));
const SupportTickets = lazy(() => import("@/pages/SupportTickets"));

const LazyFallback = <div className="grid min-h-screen place-items-center bg-[#f8f5ee] text-sm text-[#647568]">Loading AgriCoop…</div>;

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home}/>
      <Route path="/about" component={About}/>
      <Route path="/auth" component={Auth}/>
      <Route path="/marketplace" component={Marketplace}/>
      <Route path="/products/:id" component={ProductDetails}/>
      <Route path="/checkout">
        <Suspense fallback={LazyFallback}><Checkout/></Suspense>
      </Route>
      <Route path="/activity">
        <Suspense fallback={LazyFallback}><Activity/></Suspense>
      </Route>
      <Route path="/support">
        <Suspense fallback={LazyFallback}><Support/></Suspense>
      </Route>
      <Route path="/support-tickets">
        <Suspense fallback={LazyFallback}><SupportTickets/></Suspense>
      </Route>
      <Route path="/reports">
        <Suspense fallback={LazyFallback}><Reports/></Suspense>
      </Route>
      <Route path="/admin/payment-options">
        <Suspense fallback={LazyFallback}><PaymentOptions/></Suspense>
      </Route>
      <Route path="/admin/audit-logs">
        <Suspense fallback={LazyFallback}><AuditLogs/></Suspense>
      </Route>
      <Route path="/dashboard">
        <Suspense fallback={LazyFallback}><Dashboard/></Suspense>
      </Route>
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
