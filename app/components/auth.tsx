import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useAccessStore } from "../store";
import Locale from "../locales";
import BotIcon from "../icons/bot.svg";
import { getClientConfig } from "../config/client";
import { PasswordInput, showToast } from "./ui-lib";
import LeftIcon from "@/app/icons/left.svg";
import clsx from "clsx";

export function AuthPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const [checking, setChecking] = useState(false);
  const goChat = () => navigate(Path.Chat);

  const validateAccessKey = async () => {
    if (checking) return;

    setChecking(true);
    try {
      const response = await fetch("/api/employee-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessKey: accessStore.accessCode,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };

      if (response.ok && result.ok) {
        goChat();
      } else {
        showToast(result.message ?? Locale.Settings.Sync.Fail);
      }
    } catch {
      showToast(Locale.Settings.Sync.Fail);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    accessStore.fetch();
    if (getClientConfig()?.isApp) {
      navigate(Path.Settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        style={{ marginTop: "3vh", marginBottom: "3vh" }}
        aria={Locale.Settings.ShowPassword}
        aria-label={Locale.Auth.Input}
        value={accessStore.accessCode}
        type="text"
        placeholder={Locale.Auth.Input}
        onChange={(e) => {
          accessStore.update(
            (access) => (access.accessCode = e.currentTarget.value),
          );
        }}
      />

      <div className={styles["auth-actions"]}>
        <IconButton
          text={
            checking ? Locale.Settings.Usage.IsChecking : Locale.Auth.Confirm
          }
          type="primary"
          disabled={checking}
          onClick={validateAccessKey}
        />
      </div>
    </div>
  );
}
