import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const About = lazy(() => import("@/pages/About"));
const Auth = lazy(() => import("@/pages/Auth"));
const Activity = lazy(() => import("@/pages/Activity"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Home = lazy(() => import("@/pages/Home"));
const Marketplace = lazy(() => import("@/pages/Marketplace"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Reports = lazy(() => import("@/pages/Reports"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Support = lazy(() => import("@/pages/Support"));
const ProductDetails = lazy(() => import("@/pages/ProductDetails"));

function Router() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-[#f8f5ee] text-sm text-[#647568]">Loading AgriCoop…</div>}><Switch><Route path="/" component={Home}/><Route path="/about" component={About}/><Route path="/auth" component={Auth}/><Route path="/reset-password" component={ResetPassword}/><Route path="/marketplace" component={Marketplace}/><Route path="/products/:id" component={ProductDetails}/><Route path="/activity" component={Activity}/><Route path="/support" component={Support}/><Route path="/reports" component={Reports}/><Route path="/dashboard" component={Dashboard}/><Route path="/404" component={NotFound}/><Route component={NotFound}/></Switch></Suspense>;
}

function App() { return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster richColors position="top-right"/><Router/></TooltipProvider></ThemeProvider></ErrorBoundary>; }
export default App;
