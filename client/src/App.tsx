import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import About from "@/pages/About";
import Auth from "@/pages/Auth";
import Activity from "@/pages/Activity";
import Dashboard from "@/pages/Dashboard";
import Home from "@/pages/Home";
import Marketplace from "@/pages/Marketplace";
import NotFound from "@/pages/NotFound";
import Reports from "@/pages/Reports";
import Support from "@/pages/Support";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() { return <Switch><Route path="/" component={Home}/><Route path="/about" component={About}/><Route path="/auth" component={Auth}/><Route path="/marketplace" component={Marketplace}/><Route path="/activity" component={Activity}/><Route path="/support" component={Support}/><Route path="/reports" component={Reports}/><Route path="/dashboard" component={Dashboard}/><Route path="/404" component={NotFound}/><Route component={NotFound}/></Switch>; }
function App() { return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster richColors position="top-right"/><Router/></TooltipProvider></ThemeProvider></ErrorBoundary>; }
export default App;
