import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";
import { getRouter } from "./router";
import { prepareAuthRedirect } from "./services/supabaseRest";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemento raiz da dashboard nao encontrado.");
}

prepareAuthRedirect();
const router = getRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
