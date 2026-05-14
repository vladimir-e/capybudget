import "../packages/app/src/styles/index.css";
import { routeTree } from "./routeTree.gen";
import { bootstrapApp } from "@/bootstrap";
import { checkForUpdates } from "@/lib/updater";

void bootstrapApp(routeTree).then(() => {
  void checkForUpdates();
});
