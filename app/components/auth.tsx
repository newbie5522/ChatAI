import styles from "./auth.module.scss";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useAccountStore } from "../store";

export function AuthPage() {
  const navigate = useNavigate();
  const accountStore = useAccountStore();
  const [checking, setChecking] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const goChat = () => navigate(Path.Chat);

  const login = async () => {
    if (checking) return;
    if (!username.trim()) {
      setError("请输入账号");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    setChecking(true);
    setError("");
    try {
      await accountStore.login(username.trim(), password);
      setPassword("");
      goChat();
    } catch (loginError) {
      setError(
        loginError instanceof TypeError
          ? "网络连接失败"
          : loginError instanceof Error
          ? loginError.message
          : "账号或密码错误",
      );
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void accountStore.fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (accountStore.authenticated) {
      goChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountStore.authenticated]);

  return (
    <div className={styles["auth-page"]}>
      <div className={styles["auth-title"]}>NewbieChat</div>
      <form
        className={styles["auth-form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void login();
        }}
      >
        <label htmlFor="account-username">账号</label>
        <input
          id="account-username"
          type="text"
          autoComplete="username"
          value={username}
          placeholder="请输入账号"
          onChange={(event) => setUsername(event.currentTarget.value)}
        />

        <label htmlFor="account-password">密码</label>
        <div className={styles["password-field"]}>
          <input
            id="account-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            placeholder="请输入密码"
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <button
            type="button"
            className={styles["password-toggle"]}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? "隐藏" : "显示"}
          </button>
        </div>

        <div className={styles["auth-error"]} aria-live="polite">
          {error}
        </div>

        <button
          className={styles["auth-submit"]}
          type="submit"
          disabled={checking}
        >
          {checking ? "正在登录…" : "登录"}
        </button>
      </form>
    </div>
  );
}
