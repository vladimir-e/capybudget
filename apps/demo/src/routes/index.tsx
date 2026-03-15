import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <Navigate to="/budget" search={{ path: "demo", name: "Demo Budget" }} />,
});
