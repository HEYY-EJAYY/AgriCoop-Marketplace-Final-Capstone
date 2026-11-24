import { PageFrame, marketingShellClass } from "@/components/AgriShell";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <PageFrame>
      <main className={`${marketingShellClass} flex min-h-[60vh] items-center justify-center py-16`}>
        <div className="agri-card w-full max-w-lg p-5 sm:p-6 text-center">
          <AlertCircle className="mx-auto h-14 w-14 text-[#a34838]" aria-hidden />
          <h1 className="mt-4 font-display text-4xl font-bold text-[#254f37]">404</h1>
          <h2 className="mt-2 text-xl font-semibold text-[#315640]">Page Not Found</h2>
          <p className="mt-4 text-sm leading-6 text-[#65766b]">
            Sorry, the page you are looking for doesn&apos;t exist. It may have been moved or deleted.
          </p>
          <Button
            type="button"
            className="agri-button mt-6 inline-flex min-h-11 items-center"
            onClick={() => setLocation("/")}
          >
            <Home className="mr-2 h-4 w-4" aria-hidden />
            Go Home
          </Button>
        </div>
      </main>
    </PageFrame>
  );
}
