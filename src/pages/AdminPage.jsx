import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  FileClock,
  Home,
  LogIn,
  LogOut,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Users,
  X
} from "lucide-react";
import { apiFetch } from "../lib/api";
import {
  API_BASE,
  APP_VERSION,
  ORDER_PAGE_SIZE,
  roleLabels,
  statusLabels,
  deploymentModes,
  paperPresets,
  defaultLayoutOptions,
  layoutPresets,
  templates,
  legacyTemplateNames,
  createEventFormFromSettings
} from "../lib/constants";
import { formatDateTime } from "../lib/format";
import { normalizeLayoutOptions } from "../lib/layout";
import { BrandLogo } from "../components/BrandLogo";

export function AdminPage({ settings, onSettingsSaved, access, onGoCustomer, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(settings);
  const [eventForm, setEventForm] = useState(createEventFormFromSettings(settings));
  const [printerState, setPrinterState] = useState({ printers: [], defaultPrinter: "", selectedPrinter: "" });
  const [printerMessage, setPrinterMessage] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [layoutOptions, setLayoutOptions] = useState(defaultLayoutOptions);
  const [layoutPreview, setLayoutPreview] = useState(null);
  const [showDeletedOrders, setShowDeletedOrders] = useState(false);
  const [showAdvancedLayout, setShowAdvancedLayout] = useState(false);
  const [openOrderMenuId, setOpenOrderMenuId] = useState(null);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [serverOrderStats, setServerOrderStats] = useState({ total: 0, printed: 0, pending: 0, deleted: 0, today: 0 });
  const initialAdminTab = window.location.pathname === "/admin/dashboard" || window.location.pathname === "/admin"
    ? "dashboard"
    : window.location.pathname === "/admin/users"
    ? "users"
    : window.location.pathname === "/admin/settings"
      ? "settings"
      : window.location.pathname === "/admin/print-layout"
        ? "layout"
        : window.location.pathname === "/admin/logs"
          ? "logs"
          : window.location.pathname === "/admin/orders"
            ? "orders"
            : "orders";
  const [adminTab, setAdminTab] = useState(initialAdminTab);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [userForm, setUserForm] = useState({ username: "", password: "", role: "client", status: "active" });
  const [editingUserId, setEditingUserId] = useState(null);
  const [userMessage, setUserMessage] = useState("");
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [openUserMenu, setOpenUserMenu] = useState(false);
  const [openUserActionMenuId, setOpenUserActionMenuId] = useState(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTemplateFilter, setOrderTemplateFilter] = useState("all");
  const isSuperAdmin = access?.role === "super_admin";
  const canUseAdminTools = ["super_admin", "admin"].includes(access?.role);
  const orderStats = serverOrderStats;
  const filteredOrders = orders.filter((order) => {
    const keyword = orderSearch.trim().toUpperCase();
    const matchesKeyword = !keyword ||
      String(order.order_no).toUpperCase().includes(keyword) ||
      String(order.customer_text).toUpperCase().includes(keyword);
    const matchesStatus = orderStatusFilter === "all" || order.print_status === orderStatusFilter;
    const matchesTemplate = orderTemplateFilter === "all" || order.template_id === orderTemplateFilter;
    return matchesKeyword && matchesStatus && matchesTemplate;
  });
  const adminNavItems = [
    { tab: "dashboard", label: "控制台", icon: Home, visible: true },
    { tab: "orders", label: "订单管理", icon: ClipboardList, visible: true },
    { tab: "layout", label: "拼版打印", icon: Printer, visible: true },
    { tab: "users", label: "账号权限", icon: Users, visible: isSuperAdmin },
    { tab: "settings", label: "系统设置", icon: Settings, visible: isSuperAdmin },
    { tab: "logs", label: "操作日志", icon: FileClock, visible: isSuperAdmin }
  ].filter((item) => item.visible);

  useEffect(() => {
    setForm(settings);
    setEventForm(createEventFormFromSettings(settings));
  }, [settings]);

  async function loadOrderStats() {
    try {
      const response = await apiFetch("/api/orders/stats");
      if (response.ok) {
        const data = await response.json();
        setServerOrderStats(data);
      }
    } catch { /* ignore */ }
  }

  async function loadOrders() {
    try {
      const params = new URLSearchParams();
      if (showDeletedOrders) params.set("deleted", "true");
      params.set("page", String(orderPage));
      params.set("pageSize", String(ORDER_PAGE_SIZE));
      const response = await apiFetch(`/api/orders?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setPrinterMessage(data.message || "订单加载失败");
        return;
      }
      const nextOrders = Array.isArray(data) ? data : (data.orders ?? []);
      setOrders(nextOrders);
      setOrderTotal(data.total ?? nextOrders.length);
      setSelectedOrderIds((ids) => ids.filter((id) => nextOrders.some((order) => order.id === id)));
    } catch {
      setPrinterMessage("订单加载失败，请检查网络连接");
    }
  }

  async function loadPrinters(options = {}) {
    try {
      const qs = options.refresh ? "?refresh=true" : "";
      const response = await apiFetch(`/api/printers${qs}`);
      const data = await response.json();
      setPrinterState({
        printers: data.printers ?? [],
        defaultPrinter: data.defaultPrinter ?? "",
        selectedPrinter: data.selectedPrinter ?? ""
      });
    } catch {
      setPrinterState({ printers: [], defaultPrinter: "", selectedPrinter: "" });
    }
  }

  async function loadUsers() {
    if (!isSuperAdmin) return;
    const response = await apiFetch("/api/users");
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "账号列表加载失败");
      return;
    }
    setUsers(data);
  }

  async function loadLogs() {
    if (!isSuperAdmin) return;
    const response = await apiFetch("/api/audit-logs");
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "操作日志加载失败");
      return;
    }
    setLogs(data);
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    loadOrders();
    loadOrderStats();
    if (canUseAdminTools) loadPrinters();
  }, []);

  useEffect(() => {
    if (!orders.length && !showDeletedOrders) return;
    loadOrders();
  }, [showDeletedOrders]);

  const isInitialPageMount = useRef(true);
  useEffect(() => {
    if (isInitialPageMount.current) { isInitialPageMount.current = false; return; }
    loadOrders();
  }, [orderPage]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!canUseAdminTools) return;
    async function loadLayoutPreview() {
      try {
        const response = await apiFetch("/api/layout/preview", {
          method: "POST",
          body: JSON.stringify({ layoutOptions: normalizeLayoutOptions(layoutOptions) })
        });
        const data = await response.json();
        setLayoutPreview(response.ok ? data : { error: data.message || "拼版参数无效" });
      } catch (error) {
        setLayoutPreview({ error: error.message });
      }
    }
    loadLayoutPreview();
  }, [layoutOptions, canUseAdminTools]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (adminTab === "users") loadUsers();
    if (adminTab === "logs") loadLogs();
  }, [adminTab, isSuperAdmin]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!isSuperAdmin && ["settings", "users", "logs"].includes(adminTab)) {
      openAdminTab("orders");
    }
  }, [adminTab, isSuperAdmin]);

  useEffect(() => {
    function closeMenus(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "mousedown" && event.target.closest(".more-menu, .admin-user-menu")) return;
      setOpenOrderMenuId(null);
      setOpenUserActionMenuId(null);
      setOpenUserMenu(false);
    }
    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

  async function saveSettings() {
    if (!isSuperAdmin) { setPrinterMessage("只有 Super Admin 可以修改系统设置"); return; }
    if (Number(form.currentNumber) < Number(settings.currentNumber) &&
      !window.confirm(`当前编号将从 ${settings.currentNumber} 调低到 ${form.currentNumber}，可能造成编号重复。确认继续？`)) return;
    try {
      const response = await apiFetch("/api/settings", { method: "PUT", body: JSON.stringify(form) });
      onSettingsSaved(await response.json());
    } catch { setPrinterMessage("设置保存失败，请检查网络连接"); }
  }

  async function resetEvent() {
    if (!isSuperAdmin) { setPrinterMessage("只有 Super Admin 可以重置活动编号"); return; }
    if (!window.confirm("确认开启新活动并重置编号？历史订单编号不会改变。")) return;
    try {
      const response = await apiFetch("/api/events/reset", { method: "POST", body: JSON.stringify(eventForm) });
      const data = await response.json();
      if (!response.ok) { setPrinterMessage(data.message || "新活动重置失败"); return; }
      onSettingsSaved(data.settings);
      setPrinterMessage("新活动已启用，后续订单将使用新编号");
      loadOrders();
      loadOrderStats();
    } catch { setPrinterMessage("新活动重置失败，请检查网络连接"); }
  }

  async function togglePrinted(order) {
    try {
      await apiFetch(`/api/orders/${order.id}/print-status`, {
        method: "PATCH",
        body: JSON.stringify({ printStatus: order.print_status === "printed" ? "pending" : "printed" })
      });
      loadOrders();
      loadOrderStats();
    } catch { setPrinterMessage("打印状态更新失败"); }
  }

  async function deleteOrder(order) {
    if (!window.confirm(`确认将订单 ${order.order_no} 移入回收站？文件会保留，删除不会影响当前编号。`)) return;
    const response = await apiFetch(`/api/orders/${order.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setPrinterMessage(data.message || "订单删除失败");
      return;
    }
    setSelectedOrderIds((ids) => ids.filter((id) => id !== order.id));
    loadOrders();
    loadOrderStats();
  }

  async function restoreOrder(order) {
    const response = await apiFetch(`/api/orders/${order.id}/restore`, { method: "PATCH" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setPrinterMessage(data.message || "订单恢复失败");
      return;
    }
    setPrinterMessage(`订单 ${order.order_no} 已恢复`);
    loadOrders();
    loadOrderStats();
  }

  async function printOrderDirect(order) {
    setPrinterMessage("");
    const response = await apiFetch(`/api/orders/${order.id}/print`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setPrinterMessage(data.message || "打印失败，请检查打印机"); return; }
    setPrinterMessage(data.message || `订单 ${order.order_no} 已发送到打印机`);
  }

  function toggleOrderSelection(orderId) {
    setSelectedOrderIds((ids) => ids.includes(orderId) ? ids.filter((id) => id !== orderId) : [...ids, orderId]);
  }

  function toggleAllPendingOrders() {
    const pendingIds = filteredOrders.filter((order) => order.print_status !== "printed").map((order) => order.id);
    const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedOrderIds.includes(id));
    setSelectedOrderIds(allSelected ? [] : pendingIds);
  }

  const orderTotalPages = Math.max(1, Math.ceil(orderTotal / ORDER_PAGE_SIZE));

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    setOrderPage(1);
    if (!isInitialPageMount.current) { loadOrders(); }
  }, [showDeletedOrders, orderSearch, orderStatusFilter, orderTemplateFilter]);
  /* eslint-enable react-hooks/exhaustive-deps */

  function updateLayoutOption(key, value) {
    setLayoutOptions((options) => {
      const nextOptions = { ...options, [key]: value };
      if (key === "paperPreset" && value !== "CUSTOM") {
        nextOptions.paperWidth = paperPresets[value].width;
        nextOptions.paperHeight = paperPresets[value].height;
      }
      return nextOptions;
    });
  }

  function applyLayoutPreset(preset) {
    setLayoutOptions((options) => ({ ...options, ...preset.options, autoRotate: true, cropMarks: true, showOrderNo: true }));
    setShowAdvancedLayout(false);
  }

  async function downloadImpositionPdf() {
    if (!selectedOrderIds.length) { setPrinterMessage("请先选择订单"); return; }
    const response = await apiFetch("/api/orders/imposition", {
      method: "POST",
      body: JSON.stringify({ orderIds: selectedOrderIds, layoutOptions: normalizeLayoutOptions(layoutOptions) })
    });
    if (!response.ok) {
      const data = await response.json();
      setPrinterMessage(data.message || "拼版 PDF 生成失败");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `imposition-layout-${Date.now()}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setPrinterMessage("拼版 PDF 已生成");
  }

  function openImpositionPrintPage() {
    if (!selectedOrderIds.length) { setPrinterMessage("请先选择订单"); return; }
    const params = new URLSearchParams({
      ids: selectedOrderIds.join(","),
      layout: JSON.stringify(normalizeLayoutOptions(layoutOptions))
    });
    window.open(`/print-layout?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function saveSelectedPrinter(selectedPrinter) {
    setPrinterState({ ...printerState, selectedPrinter });
    await apiFetch("/api/printers/selected", { method: "PUT", body: JSON.stringify({ selectedPrinter }) });
    setPrinterMessage("打印机选择已保存");
  }

  async function testPrinter() {
    const response = await apiFetch("/api/printers/test", { method: "POST" });
    const data = await response.json();
    setPrinterMessage(data.message || (response.ok ? "测试打印已发送" : "测试打印暂不可用"));
  }

  function openAdminTab(tab) {
    setAdminTab(tab);
    const pathMap = { dashboard: "/admin/dashboard", orders: "/admin/orders", settings: "/admin/settings", users: "/admin/users", layout: "/admin/print-layout", logs: "/admin/logs" };
    window.history.replaceState(null, "", pathMap[tab] ?? "/admin/dashboard");
  }

  function editUser(user) {
    setEditingUserId(user.id);
    setUserForm({ username: user.username, password: "", role: user.role, status: user.status });
    setUserMessage("");
    setUserDrawerOpen(true);
    setOpenUserActionMenuId(null);
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserForm({ username: "", password: "", role: "client", status: "active" });
    setUserMessage("");
  }

  function openCreateUserDrawer() { resetUserForm(); setUserDrawerOpen(true); }

  async function saveUser() {
    setUserMessage("");
    const response = await apiFetch(editingUserId ? `/api/users/${editingUserId}` : "/api/users", {
      method: editingUserId ? "PATCH" : "POST",
      body: JSON.stringify(userForm)
    });
    const data = await response.json();
    if (!response.ok) { setUserMessage(data.message || "账号保存失败"); return; }
    setUserMessage(editingUserId ? "账号已更新" : "账号已创建");
    resetUserForm();
    setUserDrawerOpen(false);
    loadUsers();
  }

  async function disableUser(user) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    const response = await apiFetch(`/api/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ username: user.username, role: user.role, status: nextStatus })
    });
    const data = await response.json();
    if (!response.ok) { setUserMessage(data.message || "状态修改失败"); return; }
    setUserMessage(`账号已${nextStatus === "active" ? "启用" : "禁用"}`);
    loadUsers();
  }

  async function resetPassword(user) {
    const password = window.prompt(`请输入 ${user.username} 的新密码（至少 6 位）`);
    if (!password) return;
    const response = await apiFetch(`/api/users/${user.id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!response.ok) { setUserMessage(data.message || "密码重置失败"); return; }
    setUserMessage("密码已重置，该账号需重新登录");
  }

  async function deleteUser(user) {
    if (!window.confirm(`确认删除账号 ${user.username}？该操作不会删除历史订单。`)) return;
    const response = await apiFetch(`/api/users/${user.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setUserMessage(data.message || "账号删除失败"); return; }
    setUserMessage("账号已删除");
    loadUsers();
  }

  return (
    <main className="admin-console">
      <header className="admin-header">
        <div className="admin-brand"><BrandLogo className="admin-logo" /></div>
        <nav className="admin-top-nav">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            return (<button className={adminTab === item.tab ? "active" : ""} key={item.tab} onClick={() => openAdminTab(item.tab)} type="button"><Icon size={16} /><span>{item.label}</span></button>);
          })}
        </nav>
        <label className="admin-search">
          <Search size={16} />
          <input placeholder="搜索订单编号 / 姓名..." value={orderSearch} onChange={(event) => { setOrderSearch(event.target.value); if (adminTab !== "orders") openAdminTab("orders"); }} />
        </label>
        <div className="admin-header-actions">
          <div className="admin-user-menu">
            <button className="admin-user-chip" onClick={() => setOpenUserMenu((v) => !v)} type="button">
              <span>{String(access?.user?.username ?? "A").slice(0, 1).toUpperCase()}</span>
              <div><strong>{access?.user?.username}</strong><small>{roleLabels[access?.role] ?? "Staff"}</small></div>
              <ChevronDown size={15} />
            </button>
            {openUserMenu && (<div className="admin-user-popover"><button onClick={onLogout} type="button">退出登录</button></div>)}
          </div>
        </div>
      </header>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand"><BrandLogo className="admin-logo" /></div>
        <nav className="admin-sidebar-nav">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            return (<button className={adminTab === item.tab ? "active" : ""} key={item.tab} onClick={() => openAdminTab(item.tab)} type="button"><Icon size={18} /><span>{item.label}</span></button>);
          })}
        </nav>
        <div className="admin-sidebar-footer">
          <button onClick={onGoCustomer} type="button"><Home size={18} /><span>返回定制页</span></button>
          <button onClick={onLogout} type="button"><LogOut size={18} /><span>退出登录</span></button>
        </div>
      </aside>
      <section className="admin-main"><div className="admin-page-card">
      {adminTab === "dashboard" && <section className="dashboard-panel">
        <div className="dashboard-hero"><div><span>Overview</span><h2>控制台</h2><p>查看今日订单、打印状态和系统运行概览。</p></div>
          <button className="secondary-btn inline" onClick={() => openAdminTab("orders")} type="button">查看订单</button></div>
        <div className="metric-grid">
          <article className="metric-card"><span>今日订单</span><strong>{orderStats.today}</strong><small>当天生成订单数量</small></article>
          <article className="metric-card"><span>总订单</span><strong>{orderStats.total}</strong><small>不含回收站订单</small></article>
          <article className="metric-card"><span>待打印</span><strong>{orderStats.pending}</strong><small>需要处理的订单</small></article>
          <article className="metric-card"><span>已打印</span><strong>{orderStats.printed}</strong><small>已完成打印订单</small></article>
        </div>
      </section>}
      {adminTab === "settings" && isSuperAdmin && <section className="panel settings-panel">
        <div className="section-title"><Settings size={20} /><span>编号设置</span></div>
        <div className="settings-grid">
          <label className="field"><span>编号前缀</span><input value={form.prefix ?? ""} onChange={(e) => setForm({ ...form, prefix: e.target.value })} /></label>
          <label className="field"><span>当前编号</span><input min="1" type="number" value={form.currentNumber ?? 1} onChange={(e) => setForm({ ...form, currentNumber: Number(e.target.value) })} /></label>
          <label className="field"><span>编号位数</span><input min="1" max="8" type="number" value={form.digits ?? 4} onChange={(e) => setForm({ ...form, digits: Number(e.target.value) })} /></label>
          <label className="toggle"><input checked={Boolean(form.watermarkEnabled)} onChange={(e) => setForm({ ...form, watermarkEnabled: e.target.checked })} type="checkbox" /><span>开启时间水印</span></label>
          <label className="toggle"><input checked={Boolean(form.creatorAutoPrint)} onChange={(e) => setForm({ ...form, creatorAutoPrint: e.target.checked })} type="checkbox" /><span>/creator 自动打印</span></label>
          <label className="toggle"><input checked={Boolean(form.creatorAutoReturn)} onChange={(e) => setForm({ ...form, creatorAutoReturn: e.target.checked })} type="checkbox" /><span>/creator 自动返回</span></label>
          <label className="field"><span>系统版本</span><input readOnly value={APP_VERSION} /></label>
        </div>
        <button className="secondary-btn" onClick={saveSettings} type="button"><CheckCircle2 size={18} />保存设置</button>
      </section>}
      {adminTab === "settings" && isSuperAdmin && <section className="panel event-reset-panel">
        <div className="section-title"><RefreshCw size={20} /><span>新活动重置编号</span></div>
        <div className="settings-grid">
          <label className="field"><span>活动名称</span><input value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} placeholder="例如：上海快闪店" /></label>
          <label className="field"><span>编号前缀</span><input value={eventForm.prefix} onChange={(e) => setEventForm({ ...eventForm, prefix: e.target.value })} /></label>
          <label className="field"><span>活动日期</span><input type="date" value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} /></label>
          <label className="field"><span>起始编号</span><input min="1" type="number" value={eventForm.startNumber} onChange={(e) => setEventForm({ ...eventForm, startNumber: Number(e.target.value) })} /></label>
          <label className="field"><span>编号位数</span><input min="1" max="8" type="number" value={eventForm.digits} onChange={(e) => setEventForm({ ...eventForm, digits: Number(e.target.value) })} /></label>
          <div className="mode-help">重置只影响后续新订单；历史订单编号、打印和删除均保持独立。</div>
        </div>
        <button className="secondary-btn" onClick={resetEvent} type="button"><RefreshCw size={18} />重置为新活动</button>
      </section>}
      {adminTab === "settings" && isSuperAdmin && <section className="panel access-settings-panel">
        <div className="section-title"><LogIn size={20} /><span>访问模式</span></div>
        <div className="settings-grid access-settings-grid">
          <label className="field"><span>部署模式</span>
            <select value={form.deploymentMode ?? "private"} onChange={(e) => setForm({ ...form, deploymentMode: e.target.value })}>
              {deploymentModes.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
            </select></label>
          <label className="field"><span>邀请码</span><input disabled={(form.deploymentMode ?? "private") !== "invite"} value={form.inviteCode ?? ""} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} placeholder="Invite 模式下填写" /></label>
          <div className="mode-help">{deploymentModes.find((m) => m.value === (form.deploymentMode ?? "private"))?.description}</div>
        </div>
        <button className="secondary-btn" onClick={saveSettings} type="button"><CheckCircle2 size={18} />保存访问模式</button>
      </section>}
      {(adminTab === "settings" || adminTab === "layout") && <section className="panel printer-panel">
        <div className="section-title"><Printer size={20} /><span>打印设置</span></div>
        <div className="printer-grid">
          <label className="field"><span>本机默认打印机</span><input readOnly value={printerState.defaultPrinter || "未读取到默认打印机"} /></label>
          <label className="field"><span>后台配置打印机名称</span>
            <select value={printerState.selectedPrinter} disabled={!isSuperAdmin} onChange={(e) => saveSelectedPrinter(e.target.value)}>
              <option value="">使用本机默认打印机</option>
              {printerState.printers.map((p) => (<option key={p.name} value={p.name}>{p.name}{p.isDefault ? "（默认）" : ""}{p.isVirtual ? "（虚拟/不出纸）" : ""}</option>))}
            </select></label>
          <button className="secondary-btn inline" onClick={() => loadPrinters({ refresh: true })} type="button"><RefreshCw size={18} />刷新</button>
          <button className="secondary-btn inline" onClick={testPrinter} type="button"><Printer size={18} />测试打印</button>
        </div>
        {printerMessage && <p className="message neutral">{printerMessage}</p>}
      </section>}
      {adminTab === "layout" && <section className="panel layout-panel">
        <div className="section-title split"><span>智能拼版设置</span>
          <strong className="layout-summary">{layoutPreview?.error ? layoutPreview.error : layoutPreview ? `${layoutPreview.paperWidth}×${layoutPreview.paperHeight}mm / ${layoutPreview.columns}列×${layoutPreview.rows}行 / 每页${layoutPreview.capacity}个${layoutPreview.autoRotated ? " / 已旋转优化" : ""}` : "计算中"}</strong>
        </div>
        <div className="layout-presets">
          {layoutPresets.map((p) => (<button className="secondary-btn inline" key={p.name} onClick={() => applyLayoutPreset(p)} type="button">{p.name}</button>))}
          <button className="secondary-btn inline" onClick={() => setShowAdvancedLayout((v) => !v)} type="button">{showAdvancedLayout ? "收起高级项" : "高级参数"}</button>
        </div>
        <div className={`layout-grid ${showAdvancedLayout ? "" : "compact"}`}>
          <label className="field"><span>纸张</span><select value={layoutOptions.paperPreset} onChange={(e) => updateLayoutOption("paperPreset", e.target.value)}><option value="A4">A4 210×297mm</option><option value="A3">A3 297×420mm</option><option value="A5">A5 148×210mm</option><option value="CUSTOM">自定义尺寸</option></select></label>
          <label className="field"><span>纸张宽 mm</span><input disabled={layoutOptions.paperPreset !== "CUSTOM"} min="20" type="number" value={layoutOptions.paperWidth} onChange={(e) => updateLayoutOption("paperWidth", e.target.value)} /></label>
          <label className="field"><span>纸张高 mm</span><input disabled={layoutOptions.paperPreset !== "CUSTOM"} min="20" type="number" value={layoutOptions.paperHeight} onChange={(e) => updateLayoutOption("paperHeight", e.target.value)} /></label>
          {showAdvancedLayout && <label className="field"><span>成品宽 mm</span><input min="5" type="number" value={layoutOptions.productWidth} onChange={(e) => updateLayoutOption("productWidth", e.target.value)} /></label>}
          {showAdvancedLayout && <label className="field"><span>成品高 mm</span><input min="5" type="number" value={layoutOptions.productHeight} onChange={(e) => updateLayoutOption("productHeight", e.target.value)} /></label>}
          {showAdvancedLayout && <label className="field"><span>最小边距 mm</span><input min="0" type="number" value={layoutOptions.margin} onChange={(e) => updateLayoutOption("margin", e.target.value)} /></label>}
          {showAdvancedLayout && <label className="field"><span>间距 mm</span><input min="0" type="number" value={layoutOptions.gap} onChange={(e) => updateLayoutOption("gap", e.target.value)} /></label>}
          {showAdvancedLayout && <label className="toggle"><input checked={layoutOptions.autoRotate} onChange={(e) => updateLayoutOption("autoRotate", e.target.checked)} type="checkbox" /><span>自动旋转优化</span></label>}
          {showAdvancedLayout && <label className="toggle"><input checked={layoutOptions.cropMarks} onChange={(e) => updateLayoutOption("cropMarks", e.target.checked)} type="checkbox" /><span>生成裁切线</span></label>}
          {showAdvancedLayout && <label className="toggle"><input checked={layoutOptions.showOrderNo} onChange={(e) => updateLayoutOption("showOrderNo", e.target.checked)} type="checkbox" /><span>下方显示编号</span></label>}
        </div>
      </section>}
      {adminTab === "users" && isSuperAdmin && <section className="panel users-panel">
        <div className="section-title split"><span>账号权限</span><button className="secondary-btn inline" onClick={openCreateUserDrawer} type="button">+ 新建账号</button></div>
        {userMessage && <p className="message neutral">{userMessage}</p>}
        <div className="table-wrap"><table className="users-table">
          <thead><tr><th>ID</th><th>账号</th><th>角色</th><th>状态</th><th>最后登录</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((u) => (<tr key={u.id}><td>{u.id}</td><td>{u.username}</td><td><span className={`role-tag ${u.role}`}>{roleLabels[u.role] ?? u.role}</span></td><td><span className={`status ${u.status}`}>{statusLabels[u.status] ?? u.status}</span></td><td>{u.last_login_at ? formatDateTime(u.last_login_at) : "-"}</td><td>{formatDateTime(u.created_at)}</td>
              <td className="actions"><div className="more-menu"><button className="icon-btn" onClick={() => setOpenUserActionMenuId(openUserActionMenuId === u.id ? null : u.id)} title="更多操作" type="button"><MoreHorizontal size={17} /></button>
                {openUserActionMenuId === u.id && (<div className="more-menu-popover"><button onClick={() => editUser(u)} type="button">编辑</button><button onClick={() => resetPassword(u)} type="button">重置密码</button><button onClick={() => disableUser(u)} type="button">{u.status === "active" ? "禁用" : "启用"}</button><button onClick={() => deleteUser(u)} type="button">删除</button></div>)}
              </div></td></tr>))}
            {!users.length && <tr><td colSpan="7" className="empty">暂无账号</td></tr>}
          </tbody></table></div>
        {userDrawerOpen && (<div className="admin-drawer-backdrop" onClick={() => setUserDrawerOpen(false)}>
          <aside className="admin-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="admin-drawer-header"><div><span>Account</span><h3>{editingUserId ? "编辑账号" : "新建账号"}</h3></div><button className="icon-btn" onClick={() => setUserDrawerOpen(false)} type="button"><X size={18} /></button></div>
            <div className="admin-drawer-body">
              <label className="field"><span>用户名</span><input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} /></label>
              <label className="field"><span>{editingUserId ? "密码由重置按钮修改" : "密码"}</span><input disabled={Boolean(editingUserId)} type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></label>
              <label className="field"><span>角色</span><select disabled={userForm.username === "gongbei"} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                {(userForm.username === "gongbei" || userForm.role === "super_admin") && <option value="super_admin">Super Admin</option>}<option value="admin">Admin</option><option value="client">Client</option></select></label>
              <label className="field"><span>状态</span><select value={userForm.status} onChange={(e) => setUserForm({ ...userForm, status: e.target.value })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
            </div>
            <div className="admin-drawer-footer"><button className="secondary-btn inline" onClick={() => setUserDrawerOpen(false)} type="button">取消</button><button className="primary-btn compact" onClick={saveUser} type="button"><CheckCircle2 size={18} />{editingUserId ? "保存账号" : "创建账号"}</button></div>
          </aside></div>)}
      </section>}
      {adminTab === "logs" && isSuperAdmin && <section className="panel logs-panel">
        <div className="section-title split"><span>操作日志</span><button className="icon-btn" onClick={loadLogs} title="刷新" type="button"><RefreshCw size={18} /></button></div>
        <div className="table-wrap"><table className="logs-table">
          <thead><tr><th>时间</th><th>账号</th><th>角色</th><th>动作</th><th>对象</th><th>IP</th></tr></thead>
          <tbody>{logs.map((l) => (<tr key={l.id}><td>{formatDateTime(l.created_at)}</td><td>{l.username || "-"}</td><td>{roleLabels[l.role] ?? l.role}</td><td>{l.action}</td><td>{l.target_type}{l.target_id ? ` #${l.target_id}` : ""}</td><td>{l.ip}</td></tr>))}
            {!logs.length && <tr><td colSpan="6" className="empty">暂无日志</td></tr>}</tbody></table></div>
      </section>}
      {adminTab === "orders" && <section className="panel orders-panel">
        <div className="section-title split"><span>{showDeletedOrders ? "订单回收站" : "订单列表"}</span>
          <div className="order-toolbar">
            {!showDeletedOrders && <strong>{selectedOrderIds.length} 已选</strong>}
            <button className="secondary-btn inline" onClick={() => setShowDeletedOrders((v) => !v)} type="button"><Trash2 size={18} />{showDeletedOrders ? "返回订单" : "回收站"}</button>
            {!showDeletedOrders && (<><button className="secondary-btn inline" onClick={downloadImpositionPdf} type="button"><Download size={18} />生成拼版PDF</button><button className="secondary-btn inline" onClick={openImpositionPrintPage} type="button"><Printer size={18} />拼版打印</button></>)}
            <button className="icon-btn" onClick={loadOrders} title="刷新" type="button"><RefreshCw size={18} /></button>
          </div></div>
        <div className="order-filter-bar">
          <label><span>搜索</span><input placeholder="姓名 / 编号" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} /></label>
          <label><span>模板</span><select value={orderTemplateFilter} onChange={(e) => setOrderTemplateFilter(e.target.value)}><option value="all">全部模板</option>{templates.map((t) => (<option key={t.id} value={t.id}>{t.displayName}</option>))}</select></label>
          <label><span>状态</span><select value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}><option value="all">全部状态</option><option value="pending">待打印</option><option value="printed">已打印</option></select></label>
        </div>
        <div className="table-wrap"><table className="orders-table">
          <thead><tr>
            <th>{!showDeletedOrders && (<input aria-label="选择所有待打印订单" checked={orders.some((o) => o.print_status !== "printed") && orders.filter((o) => o.print_status !== "printed").every((o) => selectedOrderIds.includes(o.id))} onChange={toggleAllPendingOrders} type="checkbox" />)}</th>
            <th>编号</th><th>活动</th><th>客户文字</th><th>模板</th><th>生成时间</th><th>打印状态</th><th>操作</th></tr></thead>
          <tbody>{filteredOrders.map((order) => (<tr key={order.id}>
            <td>{!showDeletedOrders && (<input aria-label={`选择 ${order.order_no}`} checked={selectedOrderIds.includes(order.id)} onChange={() => toggleOrderSelection(order.id)} type="checkbox" />)}</td>
            <td>{order.order_no}</td><td>{order.event_name ? `${order.event_name}${order.event_date ? ` / ${order.event_date}` : ""}` : "-"}</td><td>{order.customer_text}</td>
            <td>{templates.find((t) => t.id === order.template_id)?.displayName ?? legacyTemplateNames[order.template_id] ?? order.template_id}</td>
            <td>{formatDateTime(order.generated_at)}</td><td><span className={`status ${order.print_status}`}>{order.print_status === "printed" ? "已打印" : "待打印"}</span></td>
            <td className="actions">{showDeletedOrders ? (<button onClick={() => restoreOrder(order)} title="恢复订单" type="button"><RefreshCw size={17} />恢复</button>) : (<>
              <button onClick={() => printOrderDirect(order)} title="发送到默认或已配置打印机" type="button"><Printer size={17} />打印</button>
              <button onClick={() => togglePrinted(order)} title="重新打印不增加编号" type="button"><CheckCircle2 size={17} />{order.print_status === "printed" ? "标记待打" : "标记已打"}</button>
              <div className="more-menu"><button onClick={() => setOpenOrderMenuId(openOrderMenuId === order.id ? null : order.id)} title="更多操作" type="button"><MoreHorizontal size={17} />更多</button>
                {openOrderMenuId === order.id && (<div className="more-menu-popover"><a href={`${API_BASE}/api/orders/${order.id}/download/png`} title="下载 PNG"><Download size={17} /> 下载 PNG</a><a href={`${API_BASE}/api/orders/${order.id}/download/pdf`} title="下载 PDF"><Download size={17} /> 下载 PDF</a></div>)}
              </div>
              <button onClick={() => deleteOrder(order)} title="删除订单不影响编号" type="button"><Trash2 size={17} />删除</button></>)}
            </td></tr>))}
            {!filteredOrders.length && (<tr><td colSpan="8" className="empty">暂无订单</td></tr>)}</tbody></table></div>
        {orderTotalPages > 1 && (<div className="order-pagination">
          <button className="secondary-btn inline" disabled={orderPage <= 1} onClick={() => setOrderPage((p) => Math.max(1, p - 1))} type="button">上一页</button>
          <span className="order-pagination-info">第 {orderPage} / {orderTotalPages} 页，共 {orderTotal} 条</span>
          <button className="secondary-btn inline" disabled={orderPage >= orderTotalPages} onClick={() => setOrderPage((p) => Math.min(orderTotalPages, p + 1))} type="button">下一页</button>
        </div>)}
      </section>}
        </div></section>
    </main>
  );
}
