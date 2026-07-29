import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useAccountStore } from "../store";
import Locale from "../locales";
import BotIcon from "../icons/bot.svg";
import { getClientConfig } from "../config/client";
import { PasswordInput, showToast } from "./ui-lib";
import LeftIcon from "@/app/icons/left.svg";
import clsx from "clsx";

export function AuthPage() {
  const navigate = useNavigate();
  const accountStore = useAccountStore();
  const [checking, setChecking] = useState(false);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const goChat = () => navigate(Path.Chat);

  const login = async () => {
    if (checking) return;

    setChecking(true);
    try {
      await accountStore.login(username, password);
      setPassword("");
      goChat();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : Locale.Settings.Sync.Fail,
      );
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void accountStore.fetchSession();
    if (getClientConfig()?.isApp) {
      navigate(Path.Settings);
    }
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
      <div className={styles["auth-header"]}>
        <IconButton
          icon={<LeftIcon />}
          text={Locale.Auth.Return}
          onClick={() => navigate(Path.Home)}
        ></IconButton>
      </div>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <BotIcon />
      </div>

      <div className={styles["auth-title"]}>{Locale.Auth.Title}</div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>

      <PasswordInput
        style={{ marginTop: "3vh", marginBottom: "1.2vh" }}
        aria={Locale.Settings.ShowPassword}
        aria-label="Username"
        value={username}
        type="text"
        placeholder="Username"
        onChange={(e) => {
          setUsername(e.currentTarget.value);
        }}
      />
      <PasswordInput
        style={{ marginBottom: "3vh" }}
        aria={Locale.Settings.ShowPassword}
        aria-label="Password"
        value={password}
        type="password"
        placeholder="Password"
        onChange={(e) => {
          setPassword(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void login();
        }}
      />

      <div className={styles["auth-actions"]}>
        <IconButton
          text={
            checking ? Locale.Settings.Usage.IsChecking : Locale.Auth.Confirm
          }
          type="primary"
          disabled={checking}
          onClick={login}
        />
      </div>
    </div>
  );
}
