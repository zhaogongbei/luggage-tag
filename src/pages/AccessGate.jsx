import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { apiFetch } from "../lib/api";
import { deploymentModes } from "../lib/constants";

export function AccessGate({ access, onAuthenticated }) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const isMaintenance = access?.deploymentMode === "maintenance";

  async function login(event) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm)
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.message || "登录失败");
        return;
      }
      onAuthenticated(data);
    } catch {
      setMessage("网络异常，请检查网络连接后重试");
    }
  }

  async function enterInvite(event) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({ inviteCode })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.message || "邀请码无效");
        return;
      }
      onAuthenticated(data);
    } catch {
      setMessage("网络异常，请检查网络连接后重试");
    }
  }

  return (
    <main className="access-page">
      <section className="panel access-panel">
        <div className="section-title">
          <LogIn size={20} />
          <span>{isMaintenance ? "系统维护中" : "工作人员登录"}</span>
        </div>
        <p className="access-copy">
          当前模式：{deploymentModes.find((mode) => mode.value === access?.deploymentMode)?.label ?? "Private"}。
          未登录用户无法访问业务页面。
        </p>
        <form className="access-form" onSubmit={login}>
          <label className="field">
            <span>账号</span>
            <input
              autoComplete="username"
              value={loginForm.username}
              onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              autoComplete="current-password"
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
            />
          </label>
          <button className="primary-btn" type="submit">
            <LogIn size={18} />
            登录后台
          </button>
        </form>
        {access?.deploymentMode === "invite" && (
          <form className="access-form invite-form" onSubmit={enterInvite}>
            <label className="field">
              <span>客户邀请码</span>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
            </label>
            <button className="secondary-btn" type="submit">进入定制页</button>
          </form>
        )}
        {message && <p className="message">{message}</p>}
      </section>
    </main>
  );
}

export function StaffOnlyPage({ children }) {
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccess() {
      try {
        const response = await apiFetch("/api/auth/status");
        setAccess(await response.json());
      } catch {
        setAccess(null);
      } finally {
        setLoading(false);
      }
    }
    loadAccess();
  }, []);

  if (loading) {
    return <main className="access-page"><p className="message neutral">Loading...</p></main>;
  }

  if (!access?.authenticated) {
    return <AccessGate access={access} onAuthenticated={setAccess} />;
  }

  return children;
}
