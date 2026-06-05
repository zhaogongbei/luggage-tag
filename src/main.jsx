import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Home, LogOut, Settings } from "lucide-react";
import "./styles.css";

import { apiFetch } from "./lib/api";
import { defaultLayoutOptions, ticketPrintLayout } from "./lib/constants";
import { parseBooleanParam } from "./lib/validate";
import { BrandLogo } from "./components/BrandLogo";
import { PrintPage } from "./pages/PrintPage";
import { CustomerTicketPrintPage } from "./pages/CustomerTicketPrintPage";
import { ImpositionPrintPage } from "./pages/ImpositionPrintPage";
import { CustomerPage } from "./pages/CustomerPage";
import { AccessGate, StaffOnlyPage } from "./pages/AccessGate";
import { AdminPage } from "./pages/AdminPage";

function App() {
  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const printMatch = pathname.match(/^\/print\/(\d+)$/);
  const ticketMatch = window.location.pathname.match(/^\/ticket\/(\d+)$/);
  const impositionPrintMatch = pathname === "/print-layout" || pathname === "/print-a4";
  const creatorMode = pathname === "/creator";
  const adminMode = pathname.startsWith("/admin");
  const [page, setPage] = useState(adminMode ? "admin" : "customer");
  const [access, setAccess] = useState(null);
  const [settings, setSettings] = useState({
    prefix: "No.",
    currentNumber: 1,
    digits: 4,
    watermarkEnabled: true,
    creatorAutoPrint: false,
    creatorAutoReturn: false,
    deploymentMode: "private",
    ticketPrintLayout
  });
  const [previewNumber, setPreviewNumber] = useState("No.0001");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function loadState() {
    setLoadError("");
    const [settingsResponse, numberResponse] = await Promise.all([
      apiFetch("/api/settings"),
      apiFetch("/api/preview-number")
    ]);
    if (!settingsResponse.ok || !numberResponse.ok) {
      const data = await settingsResponse.json().catch(() => ({}));
      throw new Error(data.message || "当前模式下无法访问定制页");
    }
    setSettings(await settingsResponse.json());
    const numberData = await numberResponse.json();
    setPreviewNumber(numberData.orderNo);
  }

  async function loadAccessAndState() {
    setLoading(true);
    try {
      const response = await apiFetch("/api/auth/status");
      const nextAccess = await response.json();
      setAccess(nextAccess);
      if (nextAccess.customerAccess) {
        await loadState();
      } else if (nextAccess.authenticated) {
        const settingsResponse = await apiFetch("/api/settings");
        if (settingsResponse.ok) {
          setSettings(await settingsResponse.json());
        }
        setPage("admin");
      }
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    loadAccessAndState();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  function handleSettingsSaved(nextSettings) {
    setSettings(nextSettings);
    loadAccessAndState();
  }

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout errors — proceed with local state reset
    }
    setPage("customer");
    setAccess(null);
    loadAccessAndState();
  }

  if (printMatch) {
    return (
      <StaffOnlyPage>
        <PrintPage autoPrint={parseBooleanParam(params.get("autoPrint"))} orderId={printMatch[1]} />
      </StaffOnlyPage>
    );
  }

  if (ticketMatch) {
    return <CustomerTicketPrintPage autoPrint={parseBooleanParam(params.get("autoPrint"))} autoReturn={parseBooleanParam(params.get("autoReturn"))} orderId={ticketMatch[1]} />;
  }

  if (impositionPrintMatch) {
    const orderIds = params.get("ids")?.split(",").map(Number).filter(Boolean) ?? [];
    const layoutParam = params.get("layout");
    let layoutOptions = defaultLayoutOptions;
    if (layoutParam) {
      try {
        layoutOptions = { ...defaultLayoutOptions, ...JSON.parse(layoutParam) };
      } catch {
        layoutOptions = defaultLayoutOptions;
      }
    }
    return (
      <StaffOnlyPage>
        <ImpositionPrintPage autoPrint={parseBooleanParam(params.get("autoPrint"))} orderIds={orderIds} layoutOptions={layoutOptions} />
      </StaffOnlyPage>
    );
  }

  if (loading) {
    return <main className="access-page"><p className="message neutral">Loading...</p></main>;
  }

  if (!access?.customerAccess && !access?.authenticated) {
    return <AccessGate access={access} onAuthenticated={(nextAccess) => {
      setAccess(nextAccess);
      loadAccessAndState();
    }} />;
  }

  const customerDisabled = !access?.customerAccess;
  const activePage = customerDisabled && page === "customer" ? "admin" : page;
  const showStaffNavigation = Boolean(access?.authenticated);
  const showLogout = Boolean(access?.sessionAuthenticated || access?.authenticated || access?.invited);
  if (creatorMode) {
    return (
      <div className="app-shell creator-shell">
        <header className="creator-topbar">
          <div className="creator-brand"><BrandLogo className="brand-mark" /></div>
          {(showStaffNavigation || showLogout) && (
            <div className="creator-topbar-actions">
              {showStaffNavigation && (
                <a className="creator-admin-link" href="/admin"><Settings size={24} />后台</a>
              )}
              {showLogout && (
                <button className="creator-logout" onClick={logout} type="button"><LogOut size={24} />退出</button>
              )}
            </div>
          )}
        </header>
        {loadError && <p className="message app-message">{loadError}</p>}
        <CustomerPage onCreated={loadState} previewNumber={previewNumber} settings={settings} />
      </div>
    );
  }

  if (activePage === "admin" && !access?.authenticated) {
    if (access?.customerAccess) {
      return (
        <div className="app-shell creator-shell">
          <header className="creator-topbar">
            <div className="creator-brand"><BrandLogo className="brand-mark" /></div>
            <div className="creator-topbar-actions">
              <button className="creator-logout" onClick={logout} type="button"><LogOut size={24} />退出</button>
            </div>
          </header>
          <CustomerPage onCreated={loadState} previewNumber={previewNumber} settings={settings} />
        </div>
      );
    }
    return <AccessGate access={access} onAuthenticated={(nextAccess) => {
      setAccess(nextAccess);
      loadAccessAndState();
    }} />;
  }

  if (activePage === "admin") {
    return (
      <AdminPage
        access={access}
        onGoCustomer={() => setPage("customer")}
        onLogout={logout}
        onSettingsSaved={handleSettingsSaved}
        settings={settings}
      />
    );
  }

  const customerKiosk = activePage === "customer";

  return (
    <div className={`app-shell ${customerKiosk ? "creator-shell" : ""}`}>
      <header className={customerKiosk ? "creator-topbar" : "topbar"}>
        <div className={customerKiosk ? "creator-brand" : "brand"}>
          <BrandLogo className="brand-mark" />
        </div>
        <nav>
          {!customerKiosk && (
            <button className={activePage === "customer" ? "active" : ""} disabled={customerDisabled} onClick={() => setPage("customer")} type="button">
              <Home size={18} />定制页
            </button>
          )}
          {showStaffNavigation && (
            <button className={activePage === "admin" ? "active" : ""} onClick={() => setPage("admin")} type="button">
              <Settings size={18} />后台
            </button>
          )}
          {showLogout && (
            <button onClick={logout} type="button"><LogOut size={18} />退出</button>
          )}
        </nav>
      </header>
      {loadError && <p className="message app-message">{loadError}</p>}
      <CustomerPage onCreated={loadState} previewNumber={previewNumber} settings={settings} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
