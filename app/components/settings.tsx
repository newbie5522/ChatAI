import { useNavigate } from "react-router-dom";
import {
  useAccountStore,
  useAppConfig,
  useChatStore,
  SubmitKey,
  Theme,
} from "../store";
import Locale, {
  AllLangs,
  ALL_LANG_OPTIONS,
  changeLang,
  getLang,
  Lang,
} from "../locales";
import { Path } from "../constant";
import { List, ListItem, Select } from "./ui-lib";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import ConfigIcon from "../icons/settings.svg";
import ExportIcon from "../icons/export.svg";
import { getRoleDisplayName } from "../utils/roles";
import styles from "./settings.module.scss";

export function Settings() {
  const config = useAppConfig();
  const account = useAccountStore();
  const navigate = useNavigate();
  const exportChats = () => {
    const data = JSON.stringify(
      { version: 1, sessions: useChatStore.getState().sessions },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "newbiechat-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <div className="window-header">
        <div className="window-header-title">
          <div className="window-header-main-title">
            {Locale.Settings.Title}
          </div>
        </div>
        <div className="window-actions">
          <IconButton
            aria={Locale.UI.Close}
            icon={<CloseIcon />}
            onClick={() => navigate(Path.Chat)}
            bordered
          />
        </div>
      </div>
      <div className={styles.settings}>
        <List>
          <ListItem
            title={"账号：" + (account.user?.username ?? "")}
            subTitle={account.user ? getRoleDisplayName(account.user.role) : ""}
          >
            <IconButton
              text="退出登录"
              onClick={() =>
                void account.logout().then(() => navigate(Path.Auth))
              }
            />
          </ListItem>
          {account.isAdmin() && (
            <ListItem title="管理后台">
              <IconButton
                icon={<ConfigIcon />}
                text="进入管理后台"
                onClick={() => navigate(Path.Admin)}
              />
            </ListItem>
          )}
        </List>
        <List>
          <ListItem title={Locale.Settings.Theme}>
            <Select
              aria-label={Locale.Settings.Theme}
              value={config.theme}
              onChange={(e) =>
                config.update((state) => {
                  state.theme = e.target.value as Theme;
                })
              }
            >
              {Object.values(Theme).map((theme) => (
                <option key={theme} value={theme}>
                  {theme === Theme.Auto
                    ? "跟随系统"
                    : theme === Theme.Light
                    ? "浅色"
                    : "深色"}
                </option>
              ))}
            </Select>
          </ListItem>
          <ListItem title={Locale.Settings.Lang.Name}>
            <Select
              aria-label={Locale.Settings.Lang.Name}
              value={getLang()}
              onChange={(e) => changeLang(e.target.value as Lang)}
            >
              {AllLangs.map((lang) => (
                <option key={lang} value={lang}>
                  {ALL_LANG_OPTIONS[lang]}
                </option>
              ))}
            </Select>
          </ListItem>
          <ListItem title={Locale.Settings.SendKey}>
            <Select
              aria-label={Locale.Settings.SendKey}
              value={config.submitKey}
              onChange={(e) =>
                config.update((state) => {
                  state.submitKey = e.target.value as SubmitKey;
                })
              }
            >
              {Object.values(SubmitKey).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
          </ListItem>
          <ListItem title="字体大小">
            <input
              aria-label="字体大小"
              type="number"
              min={12}
              max={24}
              value={config.fontSize}
              onChange={(e) => {
                const size = e.target.valueAsNumber;
                if (Number.isFinite(size))
                  config.update((state) => {
                    state.fontSize = Math.max(12, Math.min(24, size));
                  });
              }}
            />
          </ListItem>
        </List>
        <List>
          <ListItem title="聊天记录">
            <IconButton
              icon={<ExportIcon />}
              text="导出聊天记录"
              onClick={exportChats}
            />
          </ListItem>
        </List>
      </div>
    </>
  );
}
