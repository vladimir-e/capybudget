import { createFileRoute } from "@tanstack/react-router";
import { HelpScreen } from "@/components/help/help-screen";

export const Route = createFileRoute("/budget/help")({
  component: HelpScreen,
});
