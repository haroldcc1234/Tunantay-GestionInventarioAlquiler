import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Storefront from "./Storefront";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith("/gestion") ? <App /> : <Storefront />}
  </React.StrictMode>,
);
