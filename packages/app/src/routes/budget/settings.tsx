import { createFileRoute } from "@tanstack/react-router";
import { SettingsScreen } from "@/components/settings/settings-screen";

export const Route = createFileRoute("/budget/settings")({
  component: SettingsScreen,
});
