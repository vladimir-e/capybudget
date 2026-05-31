import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/budget/settings")({
  component: DemoSettingsStub,
});

/**
 * Stub settings page for the web demo. The desktop shell renders a gear icon at
 * the bottom of the left navigation rail that links here; the demo can't persist
 * provider config (no Tauri plugin-store), so the message is the entire UX.
 * Unit 4 swaps this for the real settings screen with an AI-disabled notice.
 */
function DemoSettingsStub() {
  const navigate = useNavigate();
  const { path, name } = Route.useSearch();

  function handleBack() {
    navigate({ to: "/budget", search: { path, name } });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-gradient-to-b from-brand-subtle/40 to-transparent px-6 py-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="Back"
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <Settings className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground">
              Configure your AI provider and preferences
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Settings are unavailable in the demo</CardTitle>
              <CardDescription>
                The web demo runs entirely in your browser and can't store an
                AI provider configuration. Download the desktop app to pick a
                provider and add an API key.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleBack} variant="outline">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
